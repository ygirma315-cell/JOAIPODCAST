"""
Phase 1 — Transcription with Whisper (local).

Takes an MP4 (or other video/audio), produces a timestamped transcript JSON
and a plain .txt file. You can also skip Whisper if you already have a transcript.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from utils import ensure_dirs, format_timestamp, parse_timestamp, save_json


def segments_from_whisper_result(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize Whisper output into sentence-like segments with timestamps."""
    segments: list[dict[str, Any]] = []
    for i, seg in enumerate(result.get("segments") or []):
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        start = float(seg.get("start") or 0.0)
        end = float(seg.get("end") or start)
        segments.append(
            {
                "id": i,
                "start": start,
                "end": end,
                "start_ts": format_timestamp(start),
                "end_ts": format_timestamp(end),
                "text": text,
            }
        )
    return segments


def load_existing_transcript(path: Path) -> dict[str, Any]:
    """
    Load an existing transcript.

    Supported:
    - Our JSON format: { "segments": [ {start, end, text}, ... ] }
    - Plain text with lines like: [00:01:02.000 --> 00:01:05.000] Hello world
    - Plain text without timestamps (starts/ends will be 0 — not ideal for clipping)
    """
    raw = path.read_text(encoding="utf-8").strip()
    if path.suffix.lower() == ".json":
        data = json.loads(raw)
        if isinstance(data, dict) and "segments" in data:
            segs = []
            for i, seg in enumerate(data["segments"]):
                start = parse_timestamp(seg.get("start", seg.get("start_ts", 0)))
                end = parse_timestamp(seg.get("end", seg.get("end_ts", start)))
                text = (seg.get("text") or "").strip()
                if not text:
                    continue
                segs.append(
                    {
                        "id": i,
                        "start": start,
                        "end": end,
                        "start_ts": format_timestamp(start),
                        "end_ts": format_timestamp(end),
                        "text": text,
                    }
                )
            return {
                "source": str(path),
                "language": data.get("language"),
                "full_text": data.get("full_text") or " ".join(s["text"] for s in segs),
                "segments": segs,
            }
        raise ValueError("JSON transcript must have a top-level 'segments' list.")

    # Try SRT-like / bracket timestamps
    import re

    pattern = re.compile(
        r"\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*-->\s*"
        r"(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\]?\s*(.*)"
    )
    segs = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        m = pattern.match(line)
        if m:
            start = parse_timestamp(m.group(1))
            end = parse_timestamp(m.group(2))
            text = m.group(3).strip()
            segs.append(
                {
                    "id": len(segs),
                    "start": start,
                    "end": end,
                    "start_ts": format_timestamp(start),
                    "end_ts": format_timestamp(end),
                    "text": text,
                }
            )
    if segs:
        return {
            "source": str(path),
            "language": None,
            "full_text": " ".join(s["text"] for s in segs),
            "segments": segs,
        }

    # Fallback: whole file as one blob (clipping quality will be poor)
    return {
        "source": str(path),
        "language": None,
        "full_text": raw,
        "segments": [
            {
                "id": 0,
                "start": 0.0,
                "end": 0.0,
                "start_ts": format_timestamp(0),
                "end_ts": format_timestamp(0),
                "text": raw,
            }
        ],
        "warning": "No timestamps found. Re-run Whisper for proper clipping.",
    }


def transcribe_video(
    video_path: Path,
    output_json: Path,
    *,
    model_size: str = "base",
    language: str | None = None,
    existing_transcript: Path | None = None,
) -> dict[str, Any]:
    """
    Transcribe video with local Whisper, or load an existing transcript.

    model_size options (bigger = more accurate, slower, more RAM):
      tiny, base, small, medium, large-v3
    Beginners: start with "base".
    """
    ensure_dirs()
    video_path = Path(video_path)
    output_json = Path(output_json)

    if existing_transcript:
        data = load_existing_transcript(Path(existing_transcript))
        data["video"] = str(video_path)
        data["skipped_whisper"] = True
        save_json(output_json, data)
        txt_path = output_json.with_suffix(".txt")
        txt_path.write_text(data.get("full_text") or "", encoding="utf-8")
        return data

    if not video_path.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")

    # Import here so the web UI can start even before Whisper is installed
    import whisper

    model = whisper.load_model(model_size)
    result = model.transcribe(
        str(video_path),
        language=language,
        verbose=False,
        word_timestamps=False,
    )
    segments = segments_from_whisper_result(result)
    data = {
        "video": str(video_path),
        "language": result.get("language"),
        "model": model_size,
        "full_text": (result.get("text") or "").strip(),
        "segments": segments,
        "skipped_whisper": False,
    }
    save_json(output_json, data)
    txt_path = output_json.with_suffix(".txt")
    # Human-readable timestamped text
    lines = [
        f"[{s['start_ts']} --> {s['end_ts']}] {s['text']}" for s in segments
    ]
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    data["txt_path"] = str(txt_path)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe a podcast video with Whisper")
    parser.add_argument("video", help="Path to MP4 (or other media)")
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        help="Output JSON path (default: outputs/<name>_transcript.json)",
    )
    parser.add_argument(
        "--model",
        default="base",
        choices=["tiny", "base", "small", "medium", "large-v3"],
        help="Whisper model size (default: base)",
    )
    parser.add_argument("--language", default=None, help="Optional language code, e.g. en")
    parser.add_argument(
        "--existing-transcript",
        default=None,
        help="Skip Whisper; load this .json/.txt transcript instead",
    )
    args = parser.parse_args()

    paths = ensure_dirs()
    video = Path(args.video)
    out = (
        Path(args.output)
        if args.output
        else paths["outputs"] / f"{video.stem}_transcript.json"
    )

    print(f"Transcribing: {video}")
    print(f"Model: {args.model}")
    data = transcribe_video(
        video,
        out,
        model_size=args.model,
        language=args.language,
        existing_transcript=Path(args.existing_transcript)
        if args.existing_transcript
        else None,
    )
    print(f"Saved: {out}")
    print(f"Segments: {len(data.get('segments') or [])}")
    if data.get("warning"):
        print("Warning:", data["warning"])


if __name__ == "__main__":
    # Allow running as script from project root or scripts/
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
