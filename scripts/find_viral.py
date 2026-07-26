"""
Phase 2 — Find the best moments 100% locally (no AI service, no API key).

Scores every possible clip window from the transcript using signals that
correlate with short-form performance:
- hook phrases ("the truth is", "nobody tells you", "here's why", ...)
- questions and exclamations
- emotional / high-energy words
- concrete numbers
- quotable sentence length
- speech density (words per second)

Outputs the same JSON shape the rest of the pipeline expects, so cutting
and captioning work unchanged. Runs entirely offline.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from utils import ensure_dirs, format_timestamp, load_json, save_json


HOOK_PATTERNS: list[tuple[re.Pattern[str], float]] = [
    (re.compile(p, re.IGNORECASE), w)
    for p, w in [
        (r"you won'?t believe", 6.0),
        (r"nobody (talks about|tells you|knows)", 6.0),
        (r"the (truth|secret|real reason|problem) (is|about)", 5.0),
        (r"here'?s (the thing|why|how|what)", 5.0),
        (r"biggest (mistake|lesson|myth|thing)", 5.0),
        (r"stop (doing|trying|saying)", 5.0),
        (r"changed my life", 5.0),
        (r"blew my mind", 5.0),
        (r"game.?changer", 4.5),
        (r"what (if|happens when|nobody)", 4.0),
        (r"why (you|people|most|everyone)", 4.0),
        (r"never (do|say|trust|tell)", 4.0),
        (r"the (best|worst) part", 3.5),
        (r"most people (don'?t|never|think)", 3.5),
        (r"let me tell you", 3.0),
        (r"\bhow (to|i|we) ", 3.0),
        (r"to be honest|honestly", 2.0),
        (r"i (couldn'?t|didn'?t|never) (believe|expect|imagine)", 3.0),
    ]
]

EMOTION_WORDS = {
    "amazing", "insane", "crazy", "unbelievable", "shocking", "terrifying",
    "incredible", "hilarious", "love", "hate", "fear", "scared", "angry",
    "broke", "rich", "money", "success", "failure", "mistake", "secret",
    "truth", "lie", "lies", "dangerous", "powerful", "weird", "huge",
    "massive", "best", "worst", "free", "instantly", "proven", "wrong",
    "nobody", "everybody", "literally", "actually", "finally", "obsessed",
}

STOPWORDS = {
    "the", "and", "that", "this", "with", "have", "from", "they", "were",
    "been", "their", "would", "there", "which", "about", "could", "other",
    "than", "then", "them", "these", "some", "what", "when", "your", "just",
    "like", "know", "really", "going", "because", "think", "people", "thing",
    "things", "very", "more", "much", "even", "also", "into", "over", "here",
    "where", "most", "make", "want", "time", "right", "yeah", "okay", "kind",
    "actually", "literally", "gonna", "want", "said", "says", "well", "mean",
}

FILLER_START = re.compile(r"^(um+|uh+|so|yeah|like|you know|i mean)[,\s]+", re.IGNORECASE)


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def sentence_score(text: str) -> tuple[float, list[str]]:
    """Score one transcript sentence. Returns (score, reasons)."""
    t = _clean(text)
    if not t:
        return 0.0, []
    low = t.lower()
    words = low.split()
    score = 1.0
    reasons: list[str] = []

    hook_weight = sum(w for p, w in HOOK_PATTERNS if p.search(low))
    if hook_weight:
        score += min(hook_weight, 8.0)
        reasons.append("strong hook phrasing")

    emo = sum(1 for w in words if w.strip(".,!?\"'()") in EMOTION_WORDS)
    if emo:
        score += min(emo * 1.5, 5.0)
        reasons.append("emotional language")

    if "?" in t:
        score += 2.0
        reasons.append("asks a question")
    if "!" in t:
        score += 1.5
        reasons.append("high energy")
    if re.search(r"\d", t):
        score += 1.5
        reasons.append("concrete numbers")

    n = len(words)
    if 6 <= n <= 30:
        score += 1.0  # quotable length
    elif n < 4:
        score *= 0.5
    return score, reasons


def _window_candidates(
    segments: list[dict[str, Any]],
    target_seconds: float,
) -> list[dict[str, Any]]:
    """Build one candidate window starting at every sentence."""
    candidates: list[dict[str, Any]] = []
    n = len(segments)
    for i in range(n):
        start = float(segments[i]["start"])
        j = i
        while j + 1 < n and float(segments[j]["end"]) - start < target_seconds * 0.9:
            j += 1
        end = float(segments[j]["end"])
        duration = end - start
        if duration < max(10.0, target_seconds * 0.35):
            continue

        total = 0.0
        reason_counts: Counter[str] = Counter()
        best_sentence = ""
        best_sentence_score = -1.0
        for k in range(i, j + 1):
            s, rs = sentence_score(segments[k].get("text") or "")
            if s > best_sentence_score:
                best_sentence_score = s
                best_sentence = _clean(segments[k].get("text") or "")
            if k == i:
                s *= 1.6  # the opening seconds decide if viewers stay
            total += s
            for r in rs:
                reason_counts[r] += 1

        words = sum(len((segments[k].get("text") or "").split()) for k in range(i, j + 1))
        wps = words / duration if duration > 0 else 0.0
        density_bonus = 2.0 if wps >= 2.2 else (1.0 if wps >= 1.6 else 0.0)

        raw = (total / max(duration, 1.0)) * 10.0 + density_bonus
        candidates.append(
            {
                "start": start,
                "end": end,
                "first": i,
                "last": j,
                "raw": raw,
                "best_sentence": best_sentence,
                "reasons": [r for r, _ in reason_counts.most_common(3)],
                "text": " ".join(
                    _clean(segments[k].get("text") or "") for k in range(i, j + 1)
                ).strip(),
            }
        )
    return candidates


def _pick_top(
    candidates: list[dict[str, Any]],
    top_n: int,
) -> list[dict[str, Any]]:
    """Greedy selection of the highest-scoring non-overlapping windows."""
    chosen: list[dict[str, Any]] = []
    for cand in sorted(candidates, key=lambda c: c["raw"], reverse=True):
        overlaps = False
        for c in chosen:
            inter = min(cand["end"], c["end"]) - max(cand["start"], c["start"])
            if inter > 0.2 * (cand["end"] - cand["start"]):
                overlaps = True
                break
        if not overlaps:
            chosen.append(cand)
        if len(chosen) >= top_n:
            break
    chosen.sort(key=lambda c: c["raw"], reverse=True)
    return chosen


def _make_title(sentence: str, max_len: int = 60) -> str:
    t = FILLER_START.sub("", _clean(sentence)).strip(" ,.")
    if not t:
        return "Podcast moment"
    t = t[0].upper() + t[1:]
    if len(t) <= max_len:
        return t
    cut = t[:max_len].rsplit(" ", 1)[0]
    return cut.rstrip(" ,.;:") + "…"


def _hashtags(text: str, k: int = 3) -> list[str]:
    words = [
        w.strip(".,!?\"'()").lower()
        for w in text.split()
    ]
    counts = Counter(
        w for w in words if len(w) > 3 and w.isalpha() and w not in STOPWORDS
    )
    tags = [f"#{w}" for w, _ in counts.most_common(k)]
    for default in ("#podcast", "#clips"):
        if default not in tags:
            tags.append(default)
    return tags[:5]


def find_viral_moments(
    transcript_path: Path,
    output_json: Path,
    *,
    top_n: int = 5,
    target_seconds: int | None = 60,
) -> dict[str, Any]:
    """Pick the top clip-worthy windows from a transcript. Fully offline."""
    transcript = load_json(Path(transcript_path))
    segments = transcript.get("segments") or []
    if not segments:
        raise ValueError("Transcript has no segments.")

    target = float(target_seconds or 60)
    candidates = _window_candidates(segments, target)
    if not candidates:
        raise ValueError(
            "Video is too short to build clips — try a longer video "
            "or a shorter target clip length."
        )
    chosen = _pick_top(candidates, top_n)

    raws = [c["raw"] for c in chosen]
    lo, hi = min(raws), max(raws)
    span = (hi - lo) or 1.0

    out_segments: list[dict[str, Any]] = []
    for idx, c in enumerate(chosen):
        score = 55 + int(round(40 * (c["raw"] - lo) / span)) if len(chosen) > 1 else 80
        hook = c["best_sentence"][:140].strip()
        reason_bits = c["reasons"] or ["a dense, self-contained story"]
        caption = hook.rstrip(".!?") if hook else _make_title(c["text"])
        out_segments.append(
            {
                "rank": idx + 1,
                "start": c["start"],
                "end": c["end"],
                "start_ts": format_timestamp(c["start"]),
                "end_ts": format_timestamp(c["end"]),
                "duration": round(c["end"] - c["start"], 3),
                "virality_score": max(0, min(100, score)),
                "title": _make_title(c["best_sentence"] or c["text"]),
                "hook": hook,
                "social_caption": caption + " 🎧",
                "hashtags": _hashtags(c["text"]),
                "reason": "Picked for " + ", ".join(reason_bits) + ".",
                "quote": hook or c["text"][:180],
                "text": c["text"],
            }
        )

    result = {
        "video": transcript.get("video"),
        "transcript": str(transcript_path),
        "model": "local-heuristic-v1 (offline, no API)",
        "target_seconds": target_seconds,
        "segments": out_segments,
    }
    save_json(Path(output_json), result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Find clip-worthy moments locally (no API key needed)"
    )
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
    args = parser.parse_args()

    paths = ensure_dirs()
    tpath = Path(args.transcript)
    out = (
        Path(args.output)
        if args.output
        else paths["outputs"] / f"{tpath.stem.replace('_transcript', '')}_viral.json"
    )

    print(f"Analyzing (offline): {tpath}")
    data = find_viral_moments(
        tpath,
        out,
        top_n=args.top,
        target_seconds=args.target_seconds,
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
