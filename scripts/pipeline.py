"""Run the full local pipeline: transcribe → find moments → cut → captions.

Everything runs on your machine. No AI services, no API keys.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable

from captions import DEFAULT_POSITION, DEFAULT_STYLE, caption_clips
from cut_clips import DEFAULT_ASPECT, cut_clips_from_viral
from find_viral import find_viral_moments
from transcribe import transcribe_video
from utils import ensure_dirs, safe_name


ProgressCb = Callable[[str, float], None]


def run_pipeline(
    video_path: Path,
    *,
    work_dir: Path | None = None,
    target_seconds: int = 60,
    top_n: int = 5,
    whisper_model: str = "base",
    language: str | None = None,
    existing_transcript: Path | None = None,
    burn_captions_flag: bool = True,
    max_clips: int | None = None,
    aspect: str = DEFAULT_ASPECT,
    watermark: str | None = None,
    normalize_audio: bool = False,
    caption_style: str = DEFAULT_STYLE,
    caption_position: str = DEFAULT_POSITION,
    caption_font_scale: float = 1.0,
    progress: ProgressCb | None = None,
) -> dict[str, Any]:
    def report(msg: str, pct: float) -> None:
        if progress:
            progress(msg, pct)

    paths = ensure_dirs()
    video_path = Path(video_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")

    stem = Path(safe_name(video_path.name)).stem
    work_dir = Path(work_dir) if work_dir else paths["outputs"] / f"job_{stem}"
    work_dir.mkdir(parents=True, exist_ok=True)

    transcript_json = work_dir / f"{stem}_transcript.json"
    viral_json = work_dir / f"{stem}_viral.json"
    clips_dir = work_dir / "clips"

    report("Transcribing audio with Whisper (this can take a while)...", 0.05)
    transcript = transcribe_video(
        video_path,
        transcript_json,
        model_size=whisper_model,
        language=language,
        existing_transcript=existing_transcript,
    )
    report(f"Transcript ready ({len(transcript.get('segments') or [])} segments).", 0.30)

    report("Scoring the transcript for clip-worthy moments (offline)...", 0.35)
    viral = find_viral_moments(
        transcript_json,
        viral_json,
        top_n=top_n,
        target_seconds=target_seconds,
    )
    report(f"Found {len(viral.get('segments') or [])} moments.", 0.50)

    report("Cutting clips with FFmpeg...", 0.55)
    manifest = cut_clips_from_viral(
        video_path,
        viral_json,
        clips_dir,
        target_seconds=float(target_seconds),
        transcript_path=transcript_json,
        max_clips=max_clips or top_n,
        aspect=aspect,
        watermark=watermark,
        normalize_audio=normalize_audio,
    )
    report(f"Cut {len(manifest.get('clips') or [])} clips.", 0.75)

    if burn_captions_flag and manifest.get("clips"):
        report(f"Burning {caption_style} captions...", 0.80)
        manifest = caption_clips(
            clips_dir / "clips_manifest.json",
            transcript_json,
            clips_dir,
            style_name=caption_style,
            position=caption_position,
            font_scale=caption_font_scale,
        )
        report("Captions done.", 0.95)

    report("All done!", 1.0)
    return {
        "work_dir": str(work_dir),
        "transcript": transcript,
        "transcript_path": str(transcript_json),
        "viral": viral,
        "viral_path": str(viral_json),
        "manifest": manifest,
        "clips": manifest.get("clips") or [],
    }


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    if len(sys.argv) < 2:
        print("Usage: python pipeline.py /path/to/video.mp4")
        sys.exit(1)

    def _p(msg: str, pct: float) -> None:
        print(f"[{int(pct * 100):3d}%] {msg}")

    result = run_pipeline(Path(sys.argv[1]), progress=_p)
    print("Clips:")
    for c in result["clips"]:
        print(" -", c.get("path"), c.get("title"), c.get("virality_score"))
