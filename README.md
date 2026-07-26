# ✂️ ClipForge — AI Podcast Clipper (Local · Free)

Turn long podcast videos into short, styled, caption-burned vertical clips — with AI-picked viral moments, ready-to-post social captions, and subtitle files. Everything runs on your machine; only transcript text is sent to Gemini's free tier.

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![Streamlit](https://img.shields.io/badge/UI-Streamlit-FF4B4B?logo=streamlit&logoColor=white)
![Whisper](https://img.shields.io/badge/STT-Whisper-412991?logo=openai&logoColor=white)
![Gemini](https://img.shields.io/badge/AI-Gemini%20free%20tier-4285F4?logo=google&logoColor=white)
![FFmpeg](https://img.shields.io/badge/Video-FFmpeg-007808?logo=ffmpeg&logoColor=white)
![License](https://img.shields.io/badge/cost-%240-brightgreen)

---

## ✨ Features

- **🎯 AI viral moment detection** — Gemini scores every candidate moment 0–100 and explains why it could go viral
- **🔗 YouTube import** — paste a link instead of uploading a file (via `yt-dlp`)
- **📐 Multiple frame presets** — 9:16 (TikTok/Reels/Shorts), 1:1, 16:9, or original
- **💬 4 caption styles** — Bold Classic, Sunshine Pop, Neon, Boxed · position (top/middle/bottom) · adjustable size
- **🪝 Hooks + post captions** — every clip ships with a scroll-stopping hook, a copy-ready social caption, and hashtags
- **📄 SRT export** — upload native subtitles anywhere
- **🏷️ Watermark** — optional `@yourshow` branding on every clip
- **🔊 Loudness normalization** — clips sound consistent on phone speakers
- **📚 Clip library** — browse and re-download every past job
- **📝 Transcript explorer** — search the full transcript, download the JSON
- **🔁 Resilient** — automatic retries on Gemini API hiccups; sentence-safe cuts (never mid-sentence)

## 🧱 Stack (all free for local use)

| Layer | Tool | Runs where |
|---|---|---|
| Speech-to-text | OpenAI Whisper | Your computer |
| Viral analysis | Google Gemini (free tier) | API (transcript text only) |
| Video cutting, captions | FFmpeg | Your computer |
| Web UI | Streamlit | `http://localhost:8501` |

---

## 🚀 Quickstart

### 1) Install Python 3.10+ and FFmpeg

```bash
# macOS
brew install ffmpeg

# Windows (PowerShell) — then reopen the terminal
winget install FFmpeg

# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg
```

### 2) Set up the project

```bash
git clone https://github.com/ygirma315-cell/JOAIPODCAST.git
cd JOAIPODCAST

python3 -m venv .venv
source .venv/bin/activate        # Windows: .\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt  # first install pulls PyTorch — takes a few minutes
```

### 3) Add your free Gemini key

1. Get a key at [Google AI Studio](https://aistudio.google.com/apikey)
2. `cp .env.example .env` (Windows: `copy .env.example .env`)
3. Edit `.env`: `GEMINI_API_KEY=paste_your_real_key_here`

> Or just paste the key into the app sidebar at runtime.

### 4) Run

```bash
streamlit run app.py
```

Open **http://localhost:8501**, drop in a video (or a YouTube link), pick a style, hit **⚡ Generate clips**.

---

## 🧪 Health check

```bash
python scripts/check_setup.py
```

## 🖥️ CLI (run phases individually)

```bash
# Phase 1 — transcript
python scripts/transcribe.py path/to/video.mp4

# Phase 2 — viral moments
python scripts/find_viral.py outputs/video_transcript.json --target-seconds 60

# Phase 3 — cut clips (aspect, watermark, loudness all optional)
python scripts/cut_clips.py path/to/video.mp4 outputs/video_viral.json \
  --target-seconds 60 --transcript outputs/video_transcript.json \
  --watermark "@myshow" --normalize-audio

# Phase 4 — captions (style + position + size)
python scripts/captions.py outputs/clips_video/clips_manifest.json outputs/video_transcript.json \
  --style "Sunshine Pop" --position Bottom --font-scale 1.1

# Or the whole pipeline at once
python scripts/pipeline.py path/to/video.mp4
```

## 🗂️ Project layout

```
JOAIPODCAST/
  app.py                 ← Streamlit web app (tabs: Create / Library / Transcript / Help)
  requirements.txt
  .env.example
  .streamlit/config.toml ← dark theme
  scripts/
    utils.py             ← shared helpers, SRT writer, YouTube download, job library
    transcribe.py        ← Phase 1: Whisper
    find_viral.py        ← Phase 2: Gemini (hooks, captions, retries)
    cut_clips.py         ← Phase 3: FFmpeg (aspects, watermark, loudnorm)
    captions.py          ← Phase 4: styled .ass burn-in + .srt export
    pipeline.py          ← glues 1–4
    check_setup.py       ← environment health check
  uploads/               ← your uploads land here (git-ignored)
  outputs/               ← transcripts, JSON, clips (git-ignored)
```

## 🔧 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ffmpeg: command not found` | FFmpeg not installed / terminal not restarted | Install FFmpeg, reopen terminal |
| `Missing GEMINI_API_KEY` | No `.env` or wrong folder | Paste key in sidebar, or create `.env` next to `app.py` |
| Whisper very slow | Long video or big model | Test with 2–5 min file; use `base` or `tiny` |
| Out of memory | Model too big for RAM | Use `tiny` or `base` |
| Gemini JSON / quota errors | Free-tier limits | The app retries 3× automatically; wait and retry |
| YouTube import fails | `yt-dlp` missing or restricted video | `pip install yt-dlp`; check the video is accessible |
| Watermark not visible | FFmpeg built without libass | Clips still render — watermark is skipped gracefully |

## 💰 Cost

- Whisper + FFmpeg + Streamlit: **$0** (your electricity only)
- Gemini free tier: **$0 within Google's limits** (don't share your key)

## ⚖️ Note on YouTube import

Only download and clip videos you own or have permission to use.

---

Built as a beginner-first local project. Start with a short test video before a full 2-hour episode. 🎙️
