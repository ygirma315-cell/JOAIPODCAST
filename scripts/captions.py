"""
Phase 4 — Burn styled captions with FFmpeg + Whisper timestamps.

Creates an .ass subtitle file, burns it into each clip, and also exports a
standard .srt file per clip so you can upload captions to any platform.

Caption styles are selectable presets (see CAPTION_STYLES).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

from utils import ensure_dirs, load_json, run_cmd, save_json, write_srt

# ASS colors are &HAABBGGRR (alpha, blue, green, red)
CAPTION_STYLES: dict[str, dict[str, Any]] = {
    "Bold Classic": {
        "font": "Arial",
        "size": 72,
        "primary": "&H00FFFFFF",   # white
        "outline_color": "&H00000000",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline": 5,
        "shadow": 0,
    },
    "Sunshine Pop": {
        "font": "Arial",
        "size": 74,
        "primary": "&H0000FFFF",   # yellow
        "outline_color": "&H00000000",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline": 5,
        "shadow": 1,
    },
    "Neon": {
        "font": "Arial",
        "size": 70,
        "primary": "&H00FFE500",   # cyan
        "outline_color": "&H00202020",
        "back": "&H80000000",
        "bold": -1,
        "border_style": 1,
        "outline": 4,
        "shadow": 2,
    },
    "Boxed": {
        "font": "Arial",
        "size": 64,
        "primary": "&H00FFFFFF",
        "outline_color": "&H00000000",
        "back": "&HA0000000",      # translucent dark box
        "bold": -1,
        "border_style": 3,         # opaque box
        "outline": 12,             # box padding
        "shadow": 0,
    },
}

# alignment: 2 = bottom-center, 5 = middle-center, 8 = top-center
CAPTION_POSITIONS: dict[str, tuple[int, int]] = {
    "Bottom": (2, 260),
    "Middle": (5, 0),
    "Top": (8, 160),
}

DEFAULT_STYLE = "Bold Classic"
DEFAULT_POSITION = "Bottom"


def ass_timestamp(seconds: float) -> str:
    """ASS format: H:MM:SS.cs (centiseconds)."""
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    cs = int(round((s - int(s)) * 100))
    sec = int(s)
    if cs >= 100:
        sec += 1
        cs = 0
    return f"{h}:{m:02d}:{sec:02d}.{cs:02d}"


def wrap_text(text: str, max_chars: int = 28) -> str:
    """Simple word wrap for on-screen captions (max 2 lines)."""
    words = text.split()
    lines: list[str] = []
    cur: list[str] = []
    for w in words:
        trial = (" ".join(cur + [w])).strip()
        if cur and len(trial) > max_chars:
            lines.append(" ".join(cur))
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(" ".join(cur))
    if len(lines) <= 2:
        return "\\N".join(lines)
    return "\\N".join([lines[0], " ".join(lines[1:])])


def build_ass(
    events: list[tuple[float, float, str]],
    *,
    style_name: str = DEFAULT_STYLE,
    position: str = DEFAULT_POSITION,
    font_scale: float = 1.0,
    play_res_x: int = 1080,
    play_res_y: int = 1920,
) -> str:
    """Build Advanced SubStation Alpha content with the chosen preset."""
    style = CAPTION_STYLES.get(style_name, CAPTION_STYLES[DEFAULT_STYLE])
    alignment, margin_v = CAPTION_POSITIONS.get(
        position, CAPTION_POSITIONS[DEFAULT_POSITION]
    )
    size = max(24, int(round(style["size"] * float(font_scale))))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {play_res_x}
PlayResY: {play_res_y}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ClipForge,{style['font']},{size},{style['primary']},&H000000FF,{style['outline_color']},{style['back']},{style['bold']},0,0,0,100,100,0,0,{style['border_style']},{style['outline']},{style['shadow']},{alignment},60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    for start, end, text in events:
        safe = (
            text.replace("\n", " ")
            .replace("{", "(")
            .replace("}", ")")
            .strip()
        )
        if not safe:
            continue
        body = wrap_text(safe)
        lines.append(
            f"Dialogue: 0,{ass_timestamp(start)},{ass_timestamp(end)},ClipForge,,0,0,0,,{body}\n"
        )
    return "".join(lines)


def events_for_clip(
    transcript_segments: list[dict[str, Any]],
    clip_start: float,
    clip_end: float,
) -> list[tuple[float, float, str]]:
    """Shift absolute transcript times into clip-local times."""
    events: list[tuple[float, float, str]] = []
    for seg in transcript_segments:
        s = float(seg["start"])
        e = float(seg["end"])
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        if e <= clip_start or s >= clip_end:
            continue
        local_s = max(0.0, s - clip_start)
        local_e = min(clip_end - clip_start, e - clip_start)
        if local_e - local_s < 0.05:
            continue
        events.append((local_s, local_e, text))
    return events


def burn_captions(
    clip_path: Path,
    ass_path: Path,
    output_path: Path,
) -> None:
    """Burn .ass subtitles into video."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ass_filter_path = (
        ass_path.resolve().as_posix().replace(":", "\\:").replace("'", "\\'")
    )
    vf = f"subtitles='{ass_filter_path}'"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(clip_path),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    run_cmd(cmd)


def caption_clips(
    manifest_path: Path,
    transcript_path: Path,
    output_dir: Path | None = None,
    *,
    style_name: str = DEFAULT_STYLE,
    position: str = DEFAULT_POSITION,
    font_scale: float = 1.0,
) -> dict[str, Any]:
    ensure_dirs()
    manifest = load_json(Path(manifest_path))
    transcript = load_json(Path(transcript_path))
    tsegs = transcript.get("segments") or []

    clips = manifest.get("clips") or []
    if not clips:
        raise ValueError("No clips in manifest.")

    base_dir = Path(output_dir) if output_dir else Path(clips[0]["path"]).parent
    captioned_dir = base_dir / "captioned"
    captioned_dir.mkdir(parents=True, exist_ok=True)
    ass_dir = base_dir / "ass"
    ass_dir.mkdir(parents=True, exist_ok=True)
    srt_dir = base_dir / "srt"
    srt_dir.mkdir(parents=True, exist_ok=True)

    # Figure out render resolution from the aspect used when cutting
    res_x = int(manifest.get("width") or 1080)
    res_y = int(manifest.get("height") or 1920)

    updated = []
    for clip in clips:
        clip_path = Path(clip["path"])
        if not clip_path.exists():
            continue
        c_start = float(clip["start"])
        c_end = float(clip["end"])
        events = events_for_clip(tsegs, c_start, c_end)

        ass_path = ass_dir / (clip_path.stem + ".ass")
        ass_path.write_text(
            build_ass(
                events,
                style_name=style_name,
                position=position,
                font_scale=font_scale,
                play_res_x=res_x,
                play_res_y=res_y,
            ),
            encoding="utf-8",
        )
        srt_path = write_srt(events, srt_dir / (clip_path.stem + ".srt"))

        out_path = captioned_dir / f"{clip_path.stem}_captioned.mp4"
        burn_captions(clip_path, ass_path, out_path)

        item = {
            **clip,
            "path": str(out_path),
            "filename": out_path.name,
            "uncaptioned_path": str(clip_path),
            "ass_path": str(ass_path),
            "srt_path": str(srt_path),
            "captions": True,
            "caption_style": style_name,
            "caption_position": position,
        }
        updated.append(item)

    out_manifest = {
        **manifest,
        "clips": updated,
        "captioned": True,
        "caption_style": style_name,
        "caption_position": position,
    }
    out_manifest_path = captioned_dir / "clips_manifest.json"
    save_json(out_manifest_path, out_manifest)
    return out_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Burn captions into clips")
    parser.add_argument("manifest", help="clips_manifest.json from Phase 3")
    parser.add_argument("transcript", help="transcript JSON from Phase 1")
    parser.add_argument(
        "-o",
        "--output-dir",
        default=None,
        help="Base dir containing clips (optional)",
    )
    parser.add_argument(
        "--style",
        default=DEFAULT_STYLE,
        choices=list(CAPTION_STYLES.keys()),
        help="Caption style preset",
    )
    parser.add_argument(
        "--position",
        default=DEFAULT_POSITION,
        choices=list(CAPTION_POSITIONS.keys()),
        help="Caption position on screen",
    )
    parser.add_argument(
        "--font-scale",
        type=float,
        default=1.0,
        help="Multiply caption font size (e.g. 1.2 = 20%% bigger)",
    )
    args = parser.parse_args()

    print(f"Burning captions ({args.style}, {args.position})...")
    result = caption_clips(
        Path(args.manifest),
        Path(args.transcript),
        Path(args.output_dir) if args.output_dir else None,
        style_name=args.style,
        position=args.position,
        font_scale=args.font_scale,
    )
    print(f"Captioned {len(result['clips'])} clips")
    for c in result["clips"]:
        print(f"  {c['filename']}")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
