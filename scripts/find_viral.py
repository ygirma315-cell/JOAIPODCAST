"""
Phase 2 — Find viral moments with Google Gemini (free tier).

Reads a timestamped transcript JSON and asks Gemini for the top viral segments
as clean JSON (start/end, score, title, hook, social caption, hashtags, reason).
Retries automatically on transient API errors.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from utils import (
    ensure_dirs,
    format_timestamp,
    load_json,
    parse_timestamp,
    project_root,
    save_json,
)


SYSTEM_INSTRUCTIONS = """
You are an expert short-form video editor and viral content strategist for
TikTok, Instagram Reels, and YouTube Shorts.

Given a podcast transcript with timestamps, pick the TOP viral-worthy moments.

Look for:
- Strong hooks in the first 3 seconds of the segment
- Emotional or controversial statements
- Funny moments
- Surprising facts
- Quotable one-liners
- Clear standalone stories that make sense without the full episode

Rules:
1. Never cut mid-sentence. start_time and end_time must align to full sentences
   from the transcript timestamps.
2. Prefer segments that work as standalone clips.
3. Return ONLY valid JSON (no markdown fences, no commentary).
4. Times must be in seconds (numbers) AND as HH:MM:SS.mmm strings.
5. virality_score is an integer 0-100.
6. hashtags is an array of strings without spaces (e.g. \"#podcast\").
7. reason is one clear sentence.
8. hook is the single most scroll-stopping line from the segment,
   suitable as on-screen text in the first seconds.
9. social_caption is a ready-to-post caption (1-2 punchy sentences,
   no hashtags inside it).
"""


def build_user_prompt(
    transcript: dict[str, Any],
    top_n: int,
    target_seconds: int | None,
) -> str:
    lines = []
    for seg in transcript.get("segments") or []:
        lines.append(
            f"[{seg.get('start_ts', format_timestamp(seg.get('start', 0)))} --> "
            f"{seg.get('end_ts', format_timestamp(seg.get('end', 0)))}] "
            f"{seg.get('text', '').strip()}"
        )
    body = "\n".join(lines)
    length_rule = ""
    if target_seconds:
        length_rule = (
            f"\nPrefer segments roughly {target_seconds} seconds long "
            f"(acceptable range: {max(15, target_seconds - 15)}–{target_seconds + 20}s). "
            f"Still never cut mid-sentence."
        )

    return f"""Analyze this timestamped podcast transcript and return the top {top_n} viral clips.
{length_rule}

Return JSON with this exact shape:
{{
  "segments": [
    {{
      "rank": 1,
      "start": 12.5,
      "end": 48.2,
      "start_ts": "00:00:12.500",
      "end_ts": "00:00:48.200",
      "virality_score": 87,
      "title": "Short punchy title",
      "hook": "The single most scroll-stopping line.",
      "social_caption": "Ready-to-post caption for TikTok/Reels/Shorts.",
      "hashtags": ["#podcast", "#mindset"],
      "reason": "One sentence on why this could go viral.",
      "quote": "A short representative quote from the segment."
    }}
  ]
}}

TRANSCRIPT:
{body}
"""


def extract_json(text: str) -> dict[str, Any]:
    """Parse JSON from model output, tolerating accidental markdown fences."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"Model did not return JSON. Raw output:\n{text[:2000]}")
    return json.loads(text[start : end + 1])


def snap_to_sentences(
    start: float,
    end: float,
    transcript_segments: list[dict[str, Any]],
) -> tuple[float, float, str]:
    """
    Expand/snap [start, end] so we only include full Whisper segments
    (never cut mid-sentence). Returns (new_start, new_end, joined_text).
    """
    if not transcript_segments:
        return start, end, ""

    chosen = []
    for seg in transcript_segments:
        s = float(seg["start"])
        e = float(seg["end"])
        if e > start and s < end:
            chosen.append(seg)

    if not chosen:
        nearest = min(
            transcript_segments,
            key=lambda seg: abs(float(seg["start"]) - start),
        )
        chosen = [nearest]

    new_start = float(chosen[0]["start"])
    new_end = float(chosen[-1]["end"])
    text = " ".join((c.get("text") or "").strip() for c in chosen).strip()
    return new_start, new_end, text


def normalize_segments(
    raw: dict[str, Any],
    transcript: dict[str, Any],
    top_n: int,
) -> list[dict[str, Any]]:
    segs_in = raw.get("segments") or raw.get("clips") or []
    tsegs = transcript.get("segments") or []
    out: list[dict[str, Any]] = []

    for i, item in enumerate(segs_in[:top_n]):
        start = parse_timestamp(item.get("start", item.get("start_ts", 0)))
        end = parse_timestamp(item.get("end", item.get("end_ts", start)))
        if end <= start:
            end = start + 15.0
        start, end, snapped_text = snap_to_sentences(start, end, tsegs)
        score = item.get("virality_score", item.get("score", 50))
        try:
            score = int(score)
        except (TypeError, ValueError):
            score = 50
        score = max(0, min(100, score))
        hashtags = item.get("hashtags") or []
        if isinstance(hashtags, str):
            hashtags = [h for h in re.split(r"[\s,]+", hashtags) if h]
        hashtags = [
            h if str(h).startswith("#") else f"#{h}" for h in hashtags if str(h).strip()
        ]
        out.append(
            {
                "rank": int(item.get("rank") or i + 1),
                "start": start,
                "end": end,
                "start_ts": format_timestamp(start),
                "end_ts": format_timestamp(end),
                "duration": round(end - start, 3),
                "virality_score": score,
                "title": (item.get("title") or f"Clip {i + 1}").strip(),
                "hook": (item.get("hook") or "").strip(),
                "social_caption": (item.get("social_caption") or "").strip(),
                "hashtags": hashtags,
                "reason": (item.get("reason") or "").strip(),
                "quote": (item.get("quote") or snapped_text[:180]).strip(),
                "text": snapped_text,
            }
        )
    out.sort(key=lambda x: x["virality_score"], reverse=True)
    for i, item in enumerate(out):
        item["rank"] = i + 1
    return out


def _generate_with_retries(
    client: Any,
    model_name: str,
    prompt: str,
    *,
    attempts: int = 3,
) -> dict[str, Any]:
    """Call Gemini with exponential backoff on transient errors."""
    last_err: Exception | None = None
    for attempt in range(attempts):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config={
                    "system_instruction": SYSTEM_INSTRUCTIONS,
                    "temperature": 0.4,
                    "response_mime_type": "application/json",
                },
            )
            text = getattr(response, "text", None) or str(response)
            return extract_json(text)
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < attempts - 1:
                wait = 2 ** (attempt + 1)
                print(f"Gemini attempt {attempt + 1} failed ({e}); retrying in {wait}s...")
                time.sleep(wait)
    raise RuntimeError(
        f"Gemini failed after {attempts} attempts. Last error: {last_err}\n"
        "Tips: check your API key, free-tier quota, and the model id."
    )


def find_viral_moments(
    transcript_path: Path,
    output_json: Path,
    *,
    top_n: int = 5,
    target_seconds: int | None = 60,
    model_name: str = "gemini-2.0-flash",
) -> dict[str, Any]:
    load_dotenv(project_root() / ".env")
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key or api_key == "your_gemini_api_key_here":
        raise RuntimeError(
            "Missing GEMINI_API_KEY. Create a .env file in the project folder:\n"
            "GEMINI_API_KEY=your_real_key\n"
            "Get a free key: https://aistudio.google.com/apikey"
        )

    transcript = load_json(Path(transcript_path))
    if not transcript.get("segments"):
        raise ValueError("Transcript has no segments.")

    prompt = build_user_prompt(transcript, top_n=top_n, target_seconds=target_seconds)

    try:
        from google import genai  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError(
            "google-genai is not installed. Run:\n  pip install google-genai python-dotenv"
        ) from e

    client = genai.Client(api_key=api_key)
    raw = _generate_with_retries(client, model_name, prompt)
    segments = normalize_segments(raw, transcript, top_n=top_n)

    result = {
        "video": transcript.get("video"),
        "transcript": str(transcript_path),
        "model": model_name,
        "target_seconds": target_seconds,
        "segments": segments,
    }
    save_json(Path(output_json), result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Find viral moments with Gemini")
    parser.add_argument("transcript", help="Path to transcript JSON from Phase 1")
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Output JSON (default: outputs/<name>_viral.json)",
    )
    parser.add_argument("--top", type=int, default=5, help="How many clips (default 5)")
    parser.add_argument(
        "--target-seconds",
        type=int,
        default=60,
        help="Preferred clip length in seconds (default 60)",
    )
    parser.add_argument(
        "--model",
        default="gemini-2.0-flash",
        help="Gemini model id (default gemini-2.0-flash)",
    )
    args = parser.parse_args()

    paths = ensure_dirs()
    tpath = Path(args.transcript)
    out = (
        Path(args.output)
        if args.output
        else paths["outputs"] / f"{tpath.stem.replace('_transcript', '')}_viral.json"
    )

    print(f"Analyzing: {tpath}")
    data = find_viral_moments(
        tpath,
        out,
        top_n=args.top,
        target_seconds=args.target_seconds,
        model_name=args.model,
    )
    print(f"Saved: {out}")
    for seg in data["segments"]:
        print(
            f"  #{seg['rank']} [{seg['virality_score']}] "
            f"{seg['start_ts']}→{seg['end_ts']}  {seg['title']}"
        )


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
