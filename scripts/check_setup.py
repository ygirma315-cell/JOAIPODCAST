"""Quick health check — run: python scripts/check_setup.py"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from utils import check_ffmpeg, project_root


def main() -> None:
    root = project_root()
    print("ClipForge setup check (no API keys needed)")
    print("=" * 40)
    print(f"Project: {root}")
    print(f"Python:  {sys.version.split()[0]}")

    ok, msg = check_ffmpeg()
    print(f"FFmpeg:  {'OK — ' + msg if ok else 'MISSING'}")
    if not ok:
        print(msg)

    whisper_ok = False
    try:
        import whisper  # noqa: F401

        whisper_ok = True
        print("Whisper: OK (import works)")
    except Exception as e:  # noqa: BLE001
        print(f"Whisper: NOT READY ({e})")

    ui_ok = False
    try:
        import streamlit  # noqa: F401

        ui_ok = True
        print("UI:      OK (streamlit import works)")
    except Exception as e:  # noqa: BLE001
        print(f"UI:      streamlit missing ({e})")

    try:
        import yt_dlp  # noqa: F401

        print("YouTube: OK (yt-dlp import works)")
    except Exception:  # noqa: BLE001
        print("YouTube: optional — install with: pip install yt-dlp")

    print("=" * 40)
    if ok and whisper_ok and ui_ok:
        print("All good! Run: streamlit run app.py")
    else:
        print("Finish the missing items above, then re-run this check.")


if __name__ == "__main__":
    main()
