# 🚀 Start here (beginner checklist)

## A. One-time setup

1. Install **Python 3.10+**
2. Install **FFmpeg** (`brew install ffmpeg` / `winget install FFmpeg` / `sudo apt install ffmpeg`)
3. In this folder:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate      # Windows: .\\.venv\\Scripts\\Activate.ps1
   pip install -r requirements.txt
   ```
4. Get a **free Gemini API key**: https://aistudio.google.com/apikey
5. Copy `.env.example` to `.env` and paste your key
6. Verify everything: `python scripts/check_setup.py`

## B. Every time you use it

1. `source .venv/bin/activate` (Windows: `.\\.venv\\Scripts\\Activate.ps1`)
2. `streamlit run app.py`
3. Open http://localhost:8501
4. Upload a video **or paste a YouTube link**
5. Pick clip length, caption style, frame, watermark
6. Click **⚡ Generate clips**, then download the MP4s + SRT files

## C. Good habits

- Test with a **2–5 minute** video first
- Keep the Whisper model on **base** until you need more accuracy
- Your key lives in `.env` — never commit it or share it
- Old clips live in the **📚 Library** tab — no need to re-run jobs
