"""
Phase 3 — Cut clips with FFmpeg.

Reads viral JSON, trims to target length on full-sentence boundaries,
crops to the chosen aspect ratio, optionally adds a watermark and
normalizes audio loudness, then writes MP4 clips.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

from utils import (
    ensure_dirs,
    ffprobe_duration,
    format_timestamp,
    load_json,
    run_cmd,
    save_json,
    slugify,
)

# name -> (width, height) or None to keep the original frame
ASPECT_PRESETS: dict[str, tuple[int, int] | None] = {
    "9:16 — TikTok / Reels / Shorts": (1080, 1920),
    "1:1 — Square feed": (1080, 1080),
    "16:9 — YouTube wide": (1920, 1080),
    "Original — no crop": None,
}
DEFAULT_ASPECT = "9:16 — TikTok / Reels / Shorts"


def trim_window_to_target(
    start: float,
    end: float,
    target_seconds: float,
    transcript_segments: list[dict[str, Any]],
) -> tuple[float, float]:
    """
    Keep full sentences while aiming for target_seconds.
    Strategy: grow/shrink using transcript sentence boundaries around the core.
    """
    duration = end - start
    if not transcript_segments:
        if duration > target_seconds:
            return start, start + target_seconds
        return start, end

    ordered = sorted(transcript_segments, key=lambda s: float(s["start"]))
    idxs = [
        i
        for i, s in enumerate(ordered)
        if float(s["end"]) > start and float(s["start"]) < end
    ]
    if not idxs:
        nearest_i = min(
            range(len(ordered)),
            key=lambda i: abs(float(ordered[i]["start"]) - start),
        )
        idxs = [nearest_i]

    lo, hi = idxs[0], idxs[-1]

    def window(a: int, b: int) -> tuple[float, float]:
        return float(ordered[a]["start"]), float(ordered[b]["end"])

    cur_start, cur_end = window(lo, hi)
    while (cur_end - cur_start) < target_seconds * 0.85:
        expanded = False
        if hi + 1 < len(ordered):
            hi += 1
            expanded = True
        elif lo - 1 >= 0:
            lo -= 1
            expanded = True
        cur_start, cur_end = window(lo, hi)
        if not expanded:
            break

    while (cur_end - cur_start) > target_seconds * 1.15 and hi > lo:
        trial_hi = hi - 1
        t_start, t_end = window(lo, trial_hi)
        if t_end - t_start < max(12.0, target_seconds * 0.5):
            break
        hi = trial_hi
        cur_start, cur_end = t_start, t_end

    if (cur_end - cur_start) > target_seconds * 1.5:
        hard_end = cur_start + target_seconds
        candidates = [
            float(s["end"])
            for s in ordered
            if float(s["start"]) >= cur_start - 0.01
            and float(s["end"]) <= hard_end + 0.05
        ]
        if candidates:
            cur_end = max(candidates)
        else:
            cur_end = hard_end

    if cur_end <= cur_start:
        cur_end = cur_start + min(target_seconds, 30.0)
    return cur_start, cur_end


def _write_watermark_ass(
    text: str,
    duration: float,
    size: tuple[int, int] | None,
) -> Path | None:
    """Write a small ASS overlay with the watermark pinned near the top.

    Uses libass (the `subtitles` filter) instead of `drawtext`, because many
    FFmpeg builds ship without fontconfig/drawtext but do include libass.
    """
    safe = re.sub(r"[\\{}]", "", text).strip()
    if not safe:
        return None
    res_x, res_y = size if size else (1920, 1080)
    font_size = max(24, res_y // 42)
    hours = int(duration // 3600)
    mins = int((duration % 3600) // 60)
    secs = duration % 60
    end_ts = f"{hours}:{mins:02d}:{int(secs):02d}.{int((secs - int(secs)) * 100):02d}"
    # Alignment 8 = top-center; \alpha sets ~35% transparency on the fill
    content = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {res_x}
PlayResY: {res_y}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Watermark,Arial,{font_size},&H59FFFFFF,&H000000FF,&H80000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,8,40,40,{max(20, res_y // 24)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,{end_ts},Watermark,,0,0,0,,{safe}
"""
    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".ass", delete=False, encoding="utf-8"
    )
    tmp.write(content)
    tmp.close()
    return Path(tmp.name)


def cut_clip(
    video_path: Path,
    start: float,
    end: float,
    output_path: Path,
    *,
    size: tuple[int, int] | None = (1080, 1920),
    watermark: str | None = None,
    normalize_audio: bool = False,
) -> None:
    """
    Cut [start, end) and scale/center-crop to `size` (or keep original frame).

    Filter explanation (beginner-friendly):
    - scale: resize so the frame covers the target box
    - crop: take the center region
    - subtitles: small ASS watermark overlay (optional)
    - loudnorm: consistent loudness across clips (optional)
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    duration = max(0.1, end - start)

    vf_parts: list[str] = []
    if size:
        width, height = size
        vf_parts.append(
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}"
        )

    wm_ass: Path | None = None
    if watermark:
        wm_ass = _write_watermark_ass(watermark, duration, size)
        if wm_ass:
            wm_path = (
                wm_ass.resolve().as_posix().replace(":", "\\:").replace("'", "\\'")
            )
            vf_parts.append(f"subtitles='{wm_path}'")

    try:
        cmd = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", str(video_path)]
        cmd += ["-t", f"{duration:.3f}"]
        if vf_parts:
            cmd += ["-vf", ",".join(vf_parts)]
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
        if normalize_audio:
            cmd += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
        cmd += ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(output_path)]
        run_cmd(cmd)
    finally:
        if wm_ass:
            wm_ass.unlink(missing_ok=True)


def cut_clips_from_viral(
    video_path: Path,
    viral_json: Path,
    output_dir: Path,
    *,
    target_seconds: float = 60.0,
    transcript_path: Path | None = None,
    max_clips: int | None = None,
    aspect: str = DEFAULT_ASPECT,
    watermark: str | None = None,
    normalize_audio: bool = False,
) -> dict[str, Any]:
    ensure_dirs()
    video_path = Path(video_path)
    viral = load_json(Path(viral_json))
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    size = ASPECT_PRESETS.get(aspect, ASPECT_PRESETS[DEFAULT_ASPECT])

    tsegs: list[dict[str, Any]] = []
    if transcript_path and Path(transcript_path).exists():
        tsegs = load_json(Path(transcript_path)).get("segments") or []
    elif viral.get("transcript") and Path(viral["transcript"]).exists():
        tsegs = load_json(Path(viral["transcript"])).get("segments") or []

    duration_total = ffprobe_duration(video_path)
    segments = list(viral.get("segments") or [])
    if max_clips:
        segments = segments[:max_clips]

    results = []
    for seg in segments:
        start = float(seg["start"])
        end = float(seg["end"])
        start, end = trim_window_to_target(start, end, target_seconds, tsegs)
        start = max(0.0, start)
        end = min(duration_total, end)
        if end - start < 3:
            continue

        rank = seg.get("rank", len(results) + 1)
        title = seg.get("title") or f"clip_{rank}"
        fname = f"{int(rank):02d}_{slugify(title)}.mp4"
        out_path = output_dir / fname

        try:
            cut_clip(
                video_path,
                start,
                end,
                out_path,
                size=size,
                watermark=watermark,
                normalize_audio=normalize_audio,
            )
        except RuntimeError:
            if watermark:
                # Retry without watermark if this FFmpeg build lacks libass
                cut_clip(
                    video_path,
                    start,
                    end,
                    out_path,
                    size=size,
                    watermark=None,
                    normalize_audio=normalize_audio,
                )
            else:
                raise

        item = {
            **seg,
            "start": start,
            "end": end,
            "start_ts": format_timestamp(start),
            "end_ts": format_timestamp(end),
            "duration": round(end - start, 3),
            "path": str(out_path),
            "filename": fname,
            "aspect": aspect,
            "captions": False,
        }
        results.append(item)

    manifest = {
        "video": str(video_path),
        "viral_json": str(viral_json),
        "target_seconds": target_seconds,
        "aspect": aspect,
        "width": size[0] if size else None,
        "height": size[1] if size else None,
        "watermark": watermark or None,
        "normalized_audio": normalize_audio,
        "clips": results,
    }
    manifest_path = output_dir / "clips_manifest.json"
    save_json(manifest_path, manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Cut clips with FFmpeg")
    parser.add_argument("video", help="Original podcast video")
    parser.add_argument("viral_json", help="JSON from Phase 2")
    parser.add_argument(
        "-o",
        "--output-dir",
        default=None,
        help="Folder for clips (default: outputs/clips_<name>)",
    )
    parser.add_argument(
        "--target-seconds",
        type=float,
        default=60,
        help="Target clip length: 30, 60, 120, or custom",
    )
    parser.add_argument(
        "--transcript",
        default=None,
        help="Transcript JSON for sentence-aware trimming",
    )
    parser.add_argument("--max-clips", type=int, default=None)
    parser.add_argument(
        "--aspect",
        default=DEFAULT_ASPECT,
        choices=list(ASPECT_PRESETS.keys()),
        help="Output frame preset",
    )
    parser.add_argument("--watermark", default=None, help="Small watermark text, e.g. @myshow")
    parser.add_argument(
        "--normalize-audio",
        action="store_true",
        help="Normalize loudness so all clips sound consistent",
    )
    args = parser.parse_args()

    paths = ensure_dirs()
    video = Path(args.video)
    out_dir = (
        Path(args.output_dir)
        if args.output_dir
        else paths["outputs"] / f"clips_{video.stem}"
    )

    print(f"Cutting clips from {video} → {out_dir}")
    manifest = cut_clips_from_viral(
        video,
        Path(args.viral_json),
        out_dir,
        target_seconds=args.target_seconds,
        transcript_path=Path(args.transcript) if args.transcript else None,
        max_clips=args.max_clips,
        aspect=args.aspect,
        watermark=args.watermark,
        normalize_audio=args.normalize_audio,
    )
    print(f"Created {len(manifest['clips'])} clips")
    for c in manifest["clips"]:
        print(f"  {c['filename']}  {c['duration']}s  score={c.get('virality_score')}")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
