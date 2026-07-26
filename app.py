"""
ClipForge — Podcast Clipper (local web app, no API keys)

Run from the project folder:
    streamlit run app.py

Then open the URL shown in the terminal (usually http://localhost:8501)
"""

from __future__ import annotations

import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

import streamlit as st

# Make scripts/ importable
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "scripts"))

from captions import CAPTION_POSITIONS, CAPTION_STYLES, DEFAULT_POSITION, DEFAULT_STYLE  # noqa: E402
from cut_clips import ASPECT_PRESETS, DEFAULT_ASPECT  # noqa: E402
from pipeline import run_pipeline  # noqa: E402
from utils import (  # noqa: E402
    check_ffmpeg,
    download_youtube,
    ensure_dirs,
    human_duration,
    list_jobs,
    load_json,
    safe_name,
)

ensure_dirs()

st.set_page_config(
    page_title="ClipForge — Podcast Clipper",
    page_icon="✂️",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ---------- Custom CSS ----------
st.markdown(
    """
<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    html, body, [class*="css"] {
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .block-container { padding-top: 1.2rem; max-width: 1180px; }

    /* Hero */
    .cf-hero {
        position: relative;
        border-radius: 16px;
        padding: 2rem 2.25rem;
        margin-bottom: 1.25rem;
        background:
            radial-gradient(1200px 300px at 10% -20%, rgba(124,92,255,0.35), transparent 60%),
            radial-gradient(900px 260px at 90% 120%, rgba(39,131,222,0.30), transparent 60%),
            linear-gradient(135deg, #171922 0%, #12131a 100%);
        border: 1px solid rgba(255,255,255,0.08);
        overflow: hidden;
    }
    .cf-hero h1 {
        font-size: 2.1rem;
        font-weight: 800;
        letter-spacing: -0.03em;
        margin: 0.3rem 0 0.4rem 0;
        background: linear-gradient(90deg, #FFFFFF 0%, #C9BEFF 55%, #8AB8F5 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }
    .cf-hero p { color: rgba(255,255,255,0.65); margin: 0; font-size: 1.02rem; line-height: 1.55; max-width: 640px; }

    .cf-pill {
        display: inline-flex; align-items: center; gap: 6px;
        background: rgba(124,92,255,0.16);
        color: #C9BEFF;
        border: 1px solid rgba(124,92,255,0.35);
        border-radius: 999px;
        padding: 0.2rem 0.7rem;
        font-size: 0.78rem;
        font-weight: 600;
        margin-right: 0.4rem;
    }

    /* Cards */
    .cf-card {
        border: 1px solid rgba(255,255,255,0.09);
        border-radius: 14px;
        padding: 1.1rem 1.2rem;
        background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
        margin-bottom: 0.9rem;
    }
    .cf-card h4 { margin: 0; font-weight: 700; letter-spacing: -0.01em; }

    .cf-muted { color: rgba(255,255,255,0.55); font-size: 0.88rem; }

    /* Score badges */
    .cf-score {
        display: inline-block;
        min-width: 64px;
        text-align: center;
        border-radius: 999px;
        padding: 0.22rem 0.75rem;
        font-weight: 800;
        font-size: 0.92rem;
        letter-spacing: 0.01em;
    }
    .cf-score-high { background: rgba(114,188,143,0.15); color: #72BC8F; border: 1px solid rgba(114,188,143,0.4); }
    .cf-score-mid  { background: rgba(222,146,85,0.14);  color: #DE9255; border: 1px solid rgba(222,146,85,0.4); }
    .cf-score-low  { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.15); }

    .cf-hook {
        border-left: 3px solid #7C5CFF;
        background: rgba(124,92,255,0.08);
        border-radius: 0 10px 10px 0;
        padding: 0.5rem 0.8rem;
        margin: 0.55rem 0;
        font-weight: 600;
        color: #E4DDFF;
    }
    .cf-tag {
        display: inline-block;
        background: rgba(39,131,222,0.14);
        color: #8AB8F5;
        border-radius: 6px;
        padding: 0.08rem 0.45rem;
        font-size: 0.8rem;
        font-weight: 600;
        margin: 0.15rem 0.25rem 0 0;
    }

    div[data-testid="stSidebar"] { border-right: 1px solid rgba(255,255,255,0.06); }
    .stButton > button[kind="primary"] {
        background: linear-gradient(90deg, #7C5CFF 0%, #2783DE 100%);
        border: none;
        font-weight: 700;
    }
    .stTabs [data-baseweb="tab"] { font-weight: 600; }
</style>
""",
    unsafe_allow_html=True,
)


def score_badge(score: int) -> str:
    if score >= 75:
        cls = "cf-score-high"
    elif score >= 50:
        cls = "cf-score-mid"
    else:
        cls = "cf-score-low"
    return f'<span class="cf-score {cls}">{score}/100</span>'


def init_state() -> None:
    defaults = {
        "job_result": None,
        "last_error": None,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v


def sidebar() -> None:
    st.sidebar.markdown("## ✂️ ClipForge")
    st.sidebar.caption("Long podcast in → viral vertical clips out.")
    st.sidebar.markdown("### Setup checklist")

    ok_ff, ff_msg = check_ffmpeg()
    if ok_ff:
        st.sidebar.success("FFmpeg ready")
    else:
        st.sidebar.error("FFmpeg missing")
        st.sidebar.caption(ff_msg)

    st.sidebar.success("No API keys needed — everything runs locally")

    st.sidebar.markdown("---")
    st.sidebar.markdown("### How it works")
    st.sidebar.markdown(
        """
1. **Whisper** transcribes on your computer
2. A **built-in scoring engine** picks the best moments
3. **FFmpeg** cuts clips + burns captions
4. You download and post 🚀

100% offline — nothing ever leaves your machine.
"""
    )
    st.sidebar.markdown("---")
    st.sidebar.caption("ClipForge · 100% local · no API keys")


def render_clips(clips: list[dict], key_prefix: str) -> None:
    """Render clip cards with preview, copy-ready captions, and downloads."""
    for idx, clip in enumerate(clips):
        score = int(clip.get("virality_score") or 0)
        title = clip.get("title") or "Untitled clip"
        reason = clip.get("reason") or ""
        hook = (clip.get("hook") or "").strip()
        social = (clip.get("social_caption") or "").strip()
        hashtags = clip.get("hashtags") or []
        path = Path(clip.get("path") or "")

        with st.container():
            st.markdown(
                f"""
<div class="cf-card">
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;">
    <h4>#{clip.get('rank', '—')} · {title}</h4>
    {score_badge(score)}
  </div>
  <div class="cf-muted" style="margin-top:0.3rem;">
    {clip.get('start_ts', '')} → {clip.get('end_ts', '')}
    · {human_duration(float(clip.get('duration') or 0))}
    · {clip.get('aspect', '9:16')}
    · {"captions on" if clip.get("captions") else "no captions"}
  </div>
  {f'<div class="cf-hook">🪝 {hook}</div>' if hook else ''}
  <div style="margin-top:0.4rem;">{reason}</div>
  <div style="margin-top:0.4rem;">{''.join(f'<span class="cf-tag">{h}</span>' for h in hashtags)}</div>
</div>
""",
                unsafe_allow_html=True,
            )

            col_v, col_d = st.columns([1, 1.2], gap="medium")
            with col_v:
                if path.exists():
                    try:
                        st.video(str(path))
                    except Exception:  # noqa: BLE001
                        st.caption(f"Saved at: {path}")
                else:
                    st.warning(f"File missing: {path}")
            with col_d:
                if social:
                    st.caption("Copy-ready caption")
                    st.code(social + ("\n" + " ".join(hashtags) if hashtags else ""), language=None)
                if path.exists():
                    with open(path, "rb") as f:
                        st.download_button(
                            label=f"⬇️ Download {path.name}",
                            data=f.read(),
                            file_name=path.name,
                            mime="video/mp4",
                            key=f"{key_prefix}_dl_{idx}",
                            use_container_width=True,
                        )
                srt = clip.get("srt_path")
                if srt and Path(srt).exists():
                    st.download_button(
                        label="📄 Download subtitles (.srt)",
                        data=Path(srt).read_text(encoding="utf-8"),
                        file_name=Path(srt).name,
                        mime="text/plain",
                        key=f"{key_prefix}_srt_{idx}",
                        use_container_width=True,
                    )


def tab_create() -> None:
    col_left, col_right = st.columns([1.05, 1], gap="large")

    with col_left:
        st.subheader("1 · Your video")
        source = st.radio(
            "Source",
            options=["📁 Upload a file", "🔗 YouTube link"],
            horizontal=True,
            label_visibility="collapsed",
        )

        uploaded = None
        youtube_url = ""
        if source == "📁 Upload a file":
            uploaded = st.file_uploader(
                "Upload an MP4 (or most video formats FFmpeg can read)",
                type=["mp4", "mov", "mkv", "webm", "m4v"],
                help="Start with a short test file (2–5 minutes) while you learn.",
            )
        else:
            youtube_url = st.text_input(
                "Paste a YouTube URL",
                placeholder="https://www.youtube.com/watch?v=...",
                help="Requires yt-dlp (pip install yt-dlp). Only download videos you have rights to.",
            )

        existing_tx = st.file_uploader(
            "Optional: existing transcript (.json or .txt) to skip Whisper",
            type=["json", "txt"],
            help="Use this if you already have a timestamped transcript.",
        )

        st.subheader("2 · Clip settings")
        c1, c2 = st.columns(2)
        with c1:
            length_choice = st.radio(
                "Target clip length",
                options=["30 seconds", "1 minute", "2 minutes", "Custom"],
                index=1,
            )
        with c2:
            top_n = st.slider("How many clips", 1, 10, 5)
            burn_captions = st.toggle("Burn captions", value=True)

        if length_choice == "30 seconds":
            target_seconds = 30
        elif length_choice == "1 minute":
            target_seconds = 60
        elif length_choice == "2 minutes":
            target_seconds = 120
        else:
            target_seconds = st.slider("Custom length (seconds)", 15, 180, 45, 5)

        st.subheader("3 · Style")
        s1, s2 = st.columns(2)
        with s1:
            aspect = st.selectbox("Frame", options=list(ASPECT_PRESETS.keys()), index=0)
            caption_style = st.selectbox(
                "Caption style",
                options=list(CAPTION_STYLES.keys()),
                index=list(CAPTION_STYLES.keys()).index(DEFAULT_STYLE),
                disabled=not burn_captions,
            )
        with s2:
            caption_position = st.selectbox(
                "Caption position",
                options=list(CAPTION_POSITIONS.keys()),
                index=list(CAPTION_POSITIONS.keys()).index(DEFAULT_POSITION),
                disabled=not burn_captions,
            )
            caption_font_scale = st.slider(
                "Caption size", 0.7, 1.5, 1.0, 0.1, disabled=not burn_captions
            )

        w1, w2 = st.columns(2)
        with w1:
            watermark = st.text_input(
                "Watermark (optional)", placeholder="@yourshow", max_chars=30
            )
        with w2:
            normalize_audio = st.toggle(
                "Normalize audio loudness",
                value=True,
                help="Makes every clip sound consistently loud — great for phone speakers.",
            )

        with st.expander("Advanced (optional)"):
            whisper_model = st.selectbox(
                "Whisper model size",
                options=["tiny", "base", "small", "medium"],
                index=1,
                help="tiny/base = faster. small/medium = more accurate, slower.",
            )
            language = st.text_input("Language code (blank = auto-detect)", placeholder="e.g. en")

        has_source = uploaded is not None or bool(youtube_url.strip())
        generate = st.button(
            "⚡ Generate clips",
            type="primary",
            use_container_width=True,
            disabled=not has_source,
        )

    with col_right:
        st.subheader("4 · Results")
        status_box = st.empty()
        progress_bar = st.progress(0)
        results_area = st.container()

        if st.session_state.last_error and not generate:
            status_box.error(st.session_state.last_error)

        if generate and has_source:
            st.session_state.last_error = None
            st.session_state.job_result = None

            ok_ff, ff_msg = check_ffmpeg()
            if not ok_ff:
                st.session_state.last_error = ff_msg
                status_box.error(ff_msg)
                st.stop()

            def on_progress(msg: str, pct: float) -> None:
                progress_bar.progress(min(max(pct, 0.0), 1.0))
                status_box.info(msg)

            uploads_dir = ROOT / "uploads"
            uploads_dir.mkdir(exist_ok=True)

            try:
                if uploaded is not None:
                    video_name = safe_name(uploaded.name)
                    video_path = uploads_dir / f"{int(time.time())}_{video_name}"
                    video_path.write_bytes(uploaded.getvalue())
                else:
                    status_box.info("Downloading video from YouTube...")
                    video_path = download_youtube(
                        youtube_url.strip(), uploads_dir, progress=on_progress
                    )

                tx_path = None
                if existing_tx is not None:
                    tx_name = safe_name(existing_tx.name)
                    tx_path = uploads_dir / f"{int(time.time())}_{tx_name}"
                    tx_path.write_bytes(existing_tx.getvalue())

                progress_bar.progress(0)
                status_box.info("Starting… first Whisper run may download a model (one-time).")

                result = run_pipeline(
                    video_path,
                    target_seconds=int(target_seconds),
                    top_n=int(top_n),
                    whisper_model=whisper_model,
                    language=language.strip() or None,
                    existing_transcript=tx_path,
                    burn_captions_flag=burn_captions,
                    aspect=aspect,
                    watermark=watermark.strip() or None,
                    normalize_audio=normalize_audio,
                    caption_style=caption_style,
                    caption_position=caption_position,
                    caption_font_scale=caption_font_scale,
                    progress=on_progress,
                )
                st.session_state.job_result = result
                status_box.success("Done — your clips are ready below.")
                progress_bar.progress(1.0)
            except Exception as e:  # noqa: BLE001
                err = f"{type(e).__name__}: {e}"
                st.session_state.last_error = err
                status_box.error("Something broke:\n\n" + err)
                with st.expander("Technical details"):
                    st.code(traceback.format_exc())

        result = st.session_state.job_result
        if result:
            clips = result.get("clips") or []
            if not clips:
                results_area.warning("Pipeline finished but no clips were produced.")
            with results_area:
                render_clips(clips, key_prefix="new")
            with results_area.expander("Raw job info"):
                st.write(
                    {
                        "work_dir": result.get("work_dir"),
                        "transcript_path": result.get("transcript_path"),
                        "viral_path": result.get("viral_path"),
                        "clip_count": len(clips),
                    }
                )
        else:
            results_area.markdown(
                """
<div class="cf-card">
  <h4>No clips yet</h4>
  <p class="cf-muted" style="margin:0.4rem 0 0 0;">
    Pick a video on the left, choose a style, and hit <strong>⚡ Generate clips</strong>.
    The first run is slower because Whisper downloads its model once.
  </p>
</div>
""",
                unsafe_allow_html=True,
            )


def tab_library() -> None:
    st.subheader("Your clip library")
    st.caption("Every past job found in the outputs folder, newest first.")
    jobs = list_jobs()
    if not jobs:
        st.info("No previous jobs yet — generate your first clips in the Create tab.")
        return
    for j, job in enumerate(jobs):
        when = datetime.fromtimestamp(job["modified"]).strftime("%b %d, %Y · %H:%M")
        with st.expander(
            f"🎬 {job['name']}  ·  {len(job['clips'])} clips  ·  {when}",
            expanded=(j == 0),
        ):
            render_clips(job["clips"], key_prefix=f"lib{j}")


def tab_transcript() -> None:
    st.subheader("Transcript explorer")
    result = st.session_state.job_result
    transcript = None
    transcript_path = None

    if result and result.get("transcript"):
        transcript = result["transcript"]
        transcript_path = result.get("transcript_path")
    else:
        jobs = [j for j in list_jobs() if j.get("transcript_path")]
        if jobs:
            options = {j["name"]: j for j in jobs}
            picked = st.selectbox("Pick a past job", options=list(options.keys()))
            transcript_path = options[picked]["transcript_path"]
            try:
                transcript = load_json(Path(transcript_path))
            except Exception:  # noqa: BLE001
                transcript = None

    if not transcript:
        st.info("No transcript available yet — run a job in the Create tab first.")
        return

    segments = transcript.get("segments") or []
    meta_cols = st.columns(3)
    meta_cols[0].metric("Segments", len(segments))
    meta_cols[1].metric("Language", (transcript.get("language") or "auto").upper())
    total = max((float(s.get("end") or 0) for s in segments), default=0)
    meta_cols[2].metric("Length", human_duration(total))

    query = st.text_input("🔍 Search the transcript", placeholder="Type a word or phrase…")
    shown = 0
    for seg in segments:
        text = seg.get("text") or ""
        if query and query.lower() not in text.lower():
            continue
        shown += 1
        if shown > 300:
            st.caption("… more segments hidden. Refine your search.")
            break
        st.markdown(
            f'<div class="cf-muted" style="margin-bottom:2px;">{seg.get("start_ts", "")} → {seg.get("end_ts", "")}</div>'
            f"<div style='margin-bottom:0.6rem;'>{text}</div>",
            unsafe_allow_html=True,
        )
    if query and shown == 0:
        st.warning("No matches found.")

    if transcript_path and Path(transcript_path).exists():
        st.download_button(
            "⬇️ Download transcript (.json)",
            data=Path(transcript_path).read_text(encoding="utf-8"),
            file_name=Path(transcript_path).name,
            mime="application/json",
        )


def tab_help() -> None:
    st.subheader("Quick help")
    st.markdown(
        """
**First-time setup**
1. Install Python 3.10+ and FFmpeg
2. `pip install -r requirements.txt`
3. `streamlit run app.py`

No accounts or API keys needed — everything runs on your computer.

**Tips**
- Test with a **short** video first (2–5 min). Whisper on a 2-hour episode takes a while on a laptop.
- `tiny`/`base` Whisper models are fast; `small`/`medium` are more accurate.
- YouTube import needs `pip install yt-dlp`. Only download videos you have the rights to.

**Troubleshooting**

| Symptom | Fix |
|---|---|
| `ffmpeg: command not found` | Install FFmpeg, reopen terminal |
| Whisper is slow / out of memory | Use a shorter video or `tiny`/`base` model |
| Watermark missing | Some FFmpeg builds lack libass; clips still render without it |
"""
    )


def main() -> None:
    init_state()
    sidebar()

    st.markdown(
        """
<div class="cf-hero">
  <div>
    <span class="cf-pill">🔒 100% local & private</span>
    <span class="cf-pill">🔑 No API keys</span>
    <span class="cf-pill">📱 TikTok · Reels · Shorts</span>
  </div>
  <h1>ClipForge</h1>
  <p>Drop in a long podcast — ClipForge finds the most shareable moments, cuts styled vertical clips,
  burns captions, and writes your post captions. No accounts, no keys, nothing leaves your machine.</p>
</div>
""",
        unsafe_allow_html=True,
    )

    t_create, t_library, t_transcript, t_help = st.tabs(
        ["⚡ Create", "📚 Library", "📝 Transcript", "❓ Help"]
    )
    with t_create:
        tab_create()
    with t_library:
        tab_library()
    with t_transcript:
        tab_transcript()
    with t_help:
        tab_help()


if __name__ == "__main__":
    main()
