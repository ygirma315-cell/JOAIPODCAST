"""Quick Phase 0 health check — run: python scripts/check_setup.py"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv
from utils import check_ffmpeg, project_root


def main() -> None:
    root = project_root()
    load_dotenv(root / ".env")
    print("ClipForge setup check")
    print("=" * 40)
    print(f"Project: {root}")
    print(f"Python:  {sys.version.split()[0]}")

    ok, msg = check_ffmpeg()
    print(f"FFmpeg:  {'OK — ' + msg if ok else 'MISSING'}")
    if not ok:
        print(msg)

    try:
        import whisper  # noqa: F401

        print("Whisper: OK (import works)")
    except Exception as e:  # noqa: BLE001
        print(f"Whisper: NOT READY ({e})")

    try:
        from google import genai  # noqa: F401

        print("Gemini:  OK (google-genai import works)")
    except Exception as e:  # noqa: BLE001
        print(f"Gemini:  library missing ({e})")

    try:
        import streamlit  # noqa: F401

        print("UI:      OK (streamlit import works)")
    except Exception as e:  # noqa: BLE001
        print(f"UI:      streamlit missing ({e})")

    try:
        import yt_dlp  # noqa: F401

        print("YouTube: OK (yt-dlp import works)")
    except Exception:  # noqa: BLE001
        print("YouTube: optional — install with: pip install yt-dlp")

    key = os.getenv("GEMINI_API_KEY", "").strip()
    if key and key != "your_gemini_api_key_here":
        print("API key: OK (found in environment / .env)")
    else:
        print("API key: MISSING — create .env with GEMINI_API_KEY=...")

    print("=" * 40)
    if ok and key and key != "your_gemini_api_key_here":
        print("You can run: streamlit run app.py")
    else:
        print("Finish the missing items above, then re-run this check.")


if __name__ == "__main__":
    main()
