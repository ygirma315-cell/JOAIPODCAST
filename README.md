# ✂️ ClipForge — Podcast Clipper

Turn long podcast episodes into ready-to-post **TikTok / Reels / Shorts** clips.

Runs **100% on your computer** — no accounts, no API keys, nothing uploaded anywhere.

## ✨ What it does

1. 🎧 **Transcribes** your episode locally with Whisper (works offline after the first model download)
2. 🔍 **Scores every moment** with a built-in engine that looks for hooks, questions, emotional language, concrete numbers, and speech energy
3. ✂️ **Cuts clips** with FFmpeg — 9:16 / 1:1 / 16:9 presets, watermark, loudness normalization, sentence-safe trimming (never cuts mid-sentence)
4. 💬 **Burns styled captions** — 4 style presets, position + size controls — and exports `.srt` subtitle files
5. 📝 **Writes your post** — title, hook, copy-ready caption, and hashtags for every clip

Plus: a clip **Library** of past jobs, a searchable **Transcript** explorer, and optional **YouTube import**.

## 🧰 Stack (all free)

| Piece | Tool |
|---|---|
| UI | Streamlit |
| Transcription | Whisper (runs locally) |
| Moment scoring | Built-in local engine — no API |
| Cutting & captions | FFmpeg |
| YouTube import (optional) | yt-dlp |

## 🚀 Quickstart

```bash
git clone https://github.com/ygirma315-cell/JOAIPODCAST.git
cd JOAIPODCAST
python3 -m venv .venv
source .venv/bin/activate        # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python scripts/check_setup.py    # verify FFmpeg + Whisper
streamlit run app.py
```

Open http://localhost:8501, upload a video (or paste a YouTube link), pick your style, and hit **⚡ Generate clips**.

> **FFmpeg required:** `brew install ffmpeg` (macOS) · `winget install FFmpeg` (Windows) · `sudo apt install ffmpeg` (Linux)

## 🖥️ CLI usage (optional)

Every phase also works from the terminal:

```bash
# 1. Transcribe
python scripts/transcribe.py episode.mp4

# 2. Find the best moments (offline, no key)
python scripts/find_viral.py outputs/episode_transcript.json --top 5 --target-seconds 60

# 3. Cut clips
python scripts/cut_clips.py episode.mp4 outputs/episode_viral.json \
  --aspect "9:16 — TikTok / Reels / Shorts" --watermark "@myshow" --normalize-audio

# 4. Burn captions + export SRT
python scripts/captions.py outputs/clips_episode/clips_manifest.json \
  outputs/episode_transcript.json --style "Sunshine Pop" --position Bottom

# …or run the whole pipeline in one go:
python scripts/pipeline.py episode.mp4
```

## 📁 Project layout

```
JOAIPODCAST/
├─ app.py                  # Streamlit app (run this)
├─ requirements.txt
├─ START_HERE.md           # beginner checklist
├─ .streamlit/config.toml  # dark theme + 2 GB uploads
├─ scripts/
│  ├─ pipeline.py          # runs all phases
│  ├─ transcribe.py        # Phase 1 — Whisper
│  ├─ find_viral.py        # Phase 2 — local moment scoring (no API)
│  ├─ cut_clips.py         # Phase 3 — FFmpeg cutting
│  ├─ captions.py          # Phase 4 — styled captions + SRT
│  ├─ check_setup.py       # health check
│  └─ utils.py
├─ uploads/                # your source videos land here
└─ outputs/                # finished clips land here (job_<name>/)
```

## 🆘 Troubleshooting

| Symptom | Fix |
|---|---|
| `ffmpeg: command not found` | Install FFmpeg, then reopen your terminal |
| Whisper is slow / out of memory | Use a shorter video or the `tiny`/`base` model |
| YouTube import fails | `pip install yt-dlp` — and only download videos you have rights to |
| Watermark not visible | Some FFmpeg builds lack libass; clips still render without it |
| Uploads over 2 GB rejected | Raise `maxUploadSize` in `.streamlit/config.toml` |
