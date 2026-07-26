"""Shared helpers for ClipForge."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def ensure_dirs() -> dict[str, Path]:
    root = project_root()
    paths = {
        "root": root,
        "uploads": root / "uploads",
        "outputs": root / "outputs",
        "scripts": root / "scripts",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


def check_ffmpeg() -> tuple[bool, str]:
    """Return (ok, message) after checking ffmpeg/ffprobe."""
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        return False, (
            "FFmpeg not found. Install it, then reopen your terminal.\n"
            "Mac: brew install ffmpeg\n"
            "Windows: winget install FFmpeg\n"
            "Linux: sudo apt install ffmpeg"
        )
    try:
        out = subprocess.check_output(
            [ffmpeg, "-version"], text=True, stderr=subprocess.STDOUT
        )
        first = out.splitlines()[0] if out else "ffmpeg found"
        return True, first
    except Exception as e:  # noqa: BLE001
        return False, f"FFmpeg found but failed to run: {e}"


def run_cmd(cmd: list[str], cwd: Path | None = None) -> str:
    """Run a shell command and return combined output. Raise on failure."""
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"
        )
    return (proc.stdout or "") + (proc.stderr or "")


def ffprobe_duration(video_path: Path) -> float:
    """Get video duration in seconds."""
    out = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        text=True,
    ).strip()
    return float(out)


def parse_timestamp(ts: str | float | int) -> float:
    """Convert 'HH:MM:SS.mmm', 'MM:SS', or seconds to float seconds."""
    if isinstance(ts, (int, float)):
        return float(ts)
    s = str(ts).strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        pass
    parts = s.replace(",", ".").split(":")
    try:
        parts_f = [float(p) for p in parts]
    except ValueError as e:
        raise ValueError(f"Bad timestamp: {ts}") from e
    if len(parts_f) == 3:
        h, m, sec = parts_f
        return h * 3600 + m * 60 + sec
    if len(parts_f) == 2:
        m, sec = parts_f
        return m * 60 + sec
    if len(parts_f) == 1:
        return parts_f[0]
    raise ValueError(f"Bad timestamp: {ts}")


def format_timestamp(seconds: float) -> str:
    """Format seconds as HH:MM:SS.mmm"""
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def human_duration(seconds: float) -> str:
    """Format seconds as a friendly duration like '1m 32s'."""
    seconds = max(0, int(round(seconds)))
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}h {m:02d}m {s:02d}s"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def srt_timestamp(seconds: float) -> str:
    """SRT format: HH:MM:SS,mmm"""
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms >= 1000:
        s += 1
        ms -= 1000
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(events: list[tuple[float, float, str]], path: Path) -> Path:
    """Write (start, end, text) events as a standard .srt subtitle file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    blocks = []
    for i, (start, end, text) in enumerate(events, start=1):
        clean = " ".join(str(text).split())
        if not clean:
            continue
        blocks.append(
            f"{i}\n{srt_timestamp(start)} --> {srt_timestamp(end)}\n{clean}\n"
        )
    path.write_text("\n".join(blocks) + "\n", encoding="utf-8")
    return path


def slugify(text: str, max_len: int = 40) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return (text[:max_len] or "clip").rstrip("-")


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_name(name: str) -> str:
    name = Path(name).name
    name = re.sub(r"[^\w.\- ]+", "_", name)
    return name.strip() or "video.mp4"


def list_jobs() -> list[dict[str, Any]]:
    """Scan outputs/ for previous jobs and return them, newest first.

    Each job dict: { name, dir, manifest, clips, transcript_path, modified }
    Only clips whose files still exist are included.
    """
    outputs = project_root() / "outputs"
    jobs: list[dict[str, Any]] = []
    if not outputs.exists():
        return jobs
    for d in sorted(
        outputs.glob("job_*"), key=lambda p: p.stat().st_mtime, reverse=True
    ):
        if not d.is_dir():
            continue
        manifest_path = None
        for cand in (
            d / "clips" / "captioned" / "clips_manifest.json",
            d / "clips" / "clips_manifest.json",
        ):
            if cand.exists():
                manifest_path = cand
                break
        if not manifest_path:
            continue
        try:
            manifest = load_json(manifest_path)
        except Exception:  # noqa: BLE001
            continue
        clips = [
            c
            for c in (manifest.get("clips") or [])
            if c.get("path") and Path(c["path"]).exists()
        ]
        if not clips:
            continue
        transcripts = list(d.glob("*_transcript.json"))
        jobs.append(
            {
                "name": d.name.removeprefix("job_"),
                "dir": str(d),
                "manifest": str(manifest_path),
                "clips": clips,
                "transcript_path": str(transcripts[0]) if transcripts else None,
                "modified": d.stat().st_mtime,
            }
        )
    return jobs


def download_youtube(
    url: str,
    dest_dir: Path,
    progress: Callable[[str, float], None] | None = None,
) -> Path:
    """Download a YouTube (or any yt-dlp supported) video as MP4."""
    try:
        import yt_dlp  # noqa: PLC0415
    except ImportError as e:
        raise RuntimeError(
            "yt-dlp is not installed. Run:\n  pip install yt-dlp"
        ) from e

    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    def hook(d: dict[str, Any]) -> None:
        if not progress:
            return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            pct = (done / total) if total else 0.0
            progress(f"Downloading video... {int(pct * 100)}%", pct)
        elif d.get("status") == "finished":
            progress("Download finished, processing...", 1.0)

    opts = {
        "format": (
            "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]"
            "/best[ext=mp4]/best"
        ),
        "outtmpl": str(dest_dir / "%(title).80s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "merge_output_format": "mp4",
        "progress_hooks": [hook],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info))
    if path.suffix.lower() != ".mp4":
        mp4 = path.with_suffix(".mp4")
        if mp4.exists():
            path = mp4
    if not path.exists():
        raise RuntimeError("Download finished but the video file was not found.")
    return path
