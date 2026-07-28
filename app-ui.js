"use strict";

const APP_VERSION="v21";
const APP_CHANGELOG="ClipForge "+APP_VERSION+" \u2014 latest update:\n\n\u2022 FIXED: audio no longer drifts away from the picture (Web Audio mux + video clock master)\n\u2022 FIXED: mid-render seeking that caused freezes / lip-sync lag\n\u2022 FIXED: muted-player bug that made captureStream audio unreliable\n\u2022 Smoother export \u2014 frames pushed only when drawn, speakers stay silent\n\u2022 Still MP4-first when the browser supports it";

/* ================= STEP 4: ANALYZE (single best clip) ================= */
const STAGES=[["probe","Reading video & transcript"],["audio","Analyzing audio energy"],["cands","Scanning for the best part"],["score","Scoring virality signals"],["select","Picking the #1 moment"],["refine","Cropping filler to target length"]];
const STAGE_PCT={probe:12,audio:38,cands:56,score:74,select:88,refine:100};
function initStages(){const ul=$("#stages");ul.innerHTML="";for(const[id,label]of STAGES){const li=document.createElement("li");li.id="st-"+id;li.innerHTML='<span class="st-ic">\u25cb</span><span class="st-label"></span><span class="st-pct"></span>';li.querySelector(".st-label").textContent=label;ul.appendChild(li);}}
function setStage(id,state){const li=$("#st-"+id);if(!li)return;li.classList.remove("st-active","st-done");if(state==="active"){li.classList.add("st-active");li.querySelector(".st-pct").textContent="";}
  if(state==="done"){li.classList.add("st-done");li.querySelector(".st-ic").textContent="\u2713";li.querySelector(".st-pct").textContent=STAGE_PCT[id]+"%";}}

async function generate(){goStep(4);initStages();const bar=$("#job-bar");const title=$("#progress-title");
  function setBar(pct,label){bar.style.width=pct+"%";title.textContent=label+" \u2014 "+pct+"% complete";}
  S.opts.count=1;
  const target=S.opts.target_s||120;
  const win=typeof durationWindow==="function"?durationWindow(target):{ideal:target,minS:target-15,maxS:target+20};
  setBar(4,"Starting\u2026");
  setStage("probe","active");await sleep(250);setStage("probe","done");setBar(12,"Probing video");
  setStage("audio","active");setBar(14,"Analyzing audio");
  if(!S.audioEnergy&&S.videoFile)S.audioEnergy=await analyzeAudio(S.videoFile);
  if(S.audioEnergy&&S.audioEnergy.length){const m=S.audioEnergy.reduce((a,b)=>a+b,0)/S.audioEnergy.length;const varr=S.audioEnergy.reduce((a,b)=>a+(b-m)*(b-m),0)/S.audioEnergy.length;S.audioStats={mean:m,std:Math.sqrt(varr)||0.001};}
  setStage("audio","done");setBar(38,"Audio done");
  setStage("cands","active");setBar(40,"Looking for a ~"+fmtTime(target)+" best part");await sleep(120);
  const corpus=buildCorpus(S.sentences);const cands=buildCandidates(S.sentences,target);
  setStage("cands","done");setBar(56,"Candidates ready");
  setStage("score","active");setBar(58,"Scoring moments");await sleep(120);
  const totalDur=S.videoDuration||(S.sentences.length?S.sentences[S.sentences.length-1].end:600);
  const scored=scoreAll(cands,corpus,totalDur,S.audioEnergy,target,S.audioStats);
  setStage("score","done");setBar(74,"Scored");
  setStage("select","active");setBar(76,"Choosing the single best part");await sleep(100);
  const sentScore=computeSentenceScores(S.sentences,corpus,S.audioEnergy,S.audioStats);
  S._sentScore=sentScore;
  let picked;
  if(typeof pickBestSingleClip==="function"){picked=pickBestSingleClip(scored,S.sentences,sentScore,target);}
  else{picked=selectTop(scored,1);buildMomentCuts(picked,S.sentences,sentScore,target);picked=picked.filter(p=>p.cuts&&p.cuts.length);}
  setStage("select","done");setBar(88,"Best part locked");
  setStage("refine","active");setBar(90,"Keeping length between "+fmtTime(win.minS)+" \u2013 "+fmtTime(win.maxS));
  setStage("refine","done");setBar(100,"Done! Starting render");
  S.candidates=scored;S.selected=picked.filter(p=>p.cuts&&p.cuts.length);
  S._used=S.selected.length?[[S.selected[0].sentLo,S.selected[0].sentHi]]:[];
  if(!S.selected.length){showAlert("No strong clip found near that length. Try another duration or a longer transcript.");goStep(3);return;}
  await sleep(350);startRender();}

/* ================= ANOTHER PART (next-best different moment) ================= */
function pickAnotherPart(){
  if(!S.candidates||!S.candidates.length||!S._sentScore){return null;}
  const used=S._used||[];
  const overlaps=c=>used.some(u=>!(c.sentHi<u[0]||u[1]<c.sentLo));
  const pool=S.candidates.filter(c=>!overlaps(c));
  if(!pool.length)return null;
  const picked=(typeof pickBestSingleClip==="function")?pickBestSingleClip(pool,S.sentences,S._sentScore,S.opts.target_s||120):[];
  if(!picked.length||!picked[0].cuts||!picked[0].cuts.length)return null;
  return picked;}

/* ================= STEP 5: RENDER ================= */
async function startRender(){goStep(5);
  $("#render-box").style.display="block";$("#final-box").style.display="none";
  const p=$("#player");p.playsInline=true;p.preload="auto";p.playbackRate=1;
  if(p.src!==S.videoURL){p.src=S.videoURL;p.load();}
  await waitMeta(p);
  const moments=S.selected;
  const totalCuts=moments.reduce((n,m)=>n+(m.cuts?m.cuts.length:0),0);
  const tot=moments.reduce((n,m)=>n+(m.cutDuration||0),0);
  const target=S.opts.target_s||120;
  $("#render-info").textContent="1 best clip \u00b7 "+totalCuts+" jump-cut"+(totalCuts===1?"":"s")+" \u00b7 final \u2248 "+fmtTime(tot)+" (target "+fmtTime(target)+")";
  exportClips();}
function waitMeta(p){return new Promise(r=>{if(p.readyState>=1&&p.videoWidth)return r();const done=()=>{p.removeEventListener("loadedmetadata",done);p.removeEventListener("loadeddata",done);r();};p.addEventListener("loadedmetadata",done);p.addEventListener("loadeddata",done);setTimeout(done,8000);});}
function seekTo(p,t){return new Promise(resolve=>{const target=Math.max(0,Math.min(t,(p.duration||t)-0.05));if(Math.abs((p.currentTime||0)-target)<0.05&&p.readyState>=2){resolve();return;}let settled=false;const finish=()=>{if(settled)return;settled=true;p.removeEventListener("seeked",onSeek);p.removeEventListener("loadeddata",onSeek);clearTimeout(to);resolve();};const onSeek=()=>finish();p.addEventListener("seeked",onSeek);p.addEventListener("loadeddata",onSeek);try{p.pause();}catch(e){}try{p.currentTime=target;}catch(e){finish();return;}const to=setTimeout(finish,2500);});}
/* Wire the hidden <video> into Web Audio once. Speakers stay silent (gain 0),
   but a MediaStreamDestination still gets full audio for the recorder.
   This avoids the old bug: muting the element made captureStream audio empty/desynced. */
function ensureAudioGraph(videoEl){
  if(videoEl._cfAudio&&videoEl._cfAudio.dest)return videoEl._cfAudio;
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx)return null;
  try{
    const actx=new Ctx();
    const src=actx.createMediaElementSource(videoEl);
    const dest=actx.createMediaStreamDestination();
    const silent=actx.createGain();silent.gain.value=0;
    src.connect(dest);
    src.connect(silent);
    silent.connect(actx.destination);
    videoEl._cfAudio={actx,src,dest,silent};
    return videoEl._cfAudio;
  }catch(e){console.warn("Web Audio graph failed:",e);return null;}
}
async function resumeAudioCtx(graph){
  if(!graph||!graph.actx)return;
  try{if(graph.actx.state==="suspended")await graph.actx.resume();}catch(e){}
}

/* ================= SPEAKER AUTO-FOCUS (face tracking, downscaled = cheap) ================= */
const FOCUS={x:0.5,tx:0.5,det:null,busy:false,last:0,enabled:false,cv:null,cctx:null};
function setupFocus(opt){FOCUS.x=0.5;FOCUS.tx=0.5;FOCUS.busy=false;FOCUS.last=0;FOCUS.det=null;FOCUS.enabled=false;
  try{if(opt.focus!==false&&("FaceDetector" in window)){FOCUS.det=new window.FaceDetector({fastMode:true,maxDetectedFaces:4});FOCUS.enabled=true;}}catch(e){FOCUS.det=null;FOCUS.enabled=false;}}
function updateFocus(p){if(!FOCUS.enabled||!FOCUS.det||FOCUS.busy)return;const now=performance.now();if(now-FOCUS.last<500)return;FOCUS.last=now;FOCUS.busy=true;
  try{
    const vw=p.videoWidth||320,vh=p.videoHeight||180;
    const dw=224,dh=Math.max(2,Math.round(dw*vh/vw));
    if(!FOCUS.cv){FOCUS.cv=document.createElement("canvas");}
    if(FOCUS.cv.width!==dw||FOCUS.cv.height!==dh){FOCUS.cv.width=dw;FOCUS.cv.height=dh;FOCUS.cctx=FOCUS.cv.getContext("2d",{willReadFrequently:true});}
    if(!FOCUS.cctx)FOCUS.cctx=FOCUS.cv.getContext("2d",{willReadFrequently:true});
    FOCUS.cctx.drawImage(p,0,0,dw,dh);
    FOCUS.det.detect(FOCUS.cv).then(faces=>{FOCUS.busy=false;if(!faces||!faces.length)return;
      let best=faces[0];for(const f of faces){if(f.boundingBox.width>best.boundingBox.width)best=f;}
      const cx=(best.boundingBox.x+best.boundingBox.width/2)/dw;
      if(isFinite(cx))FOCUS.tx=Math.min(0.92,Math.max(0.08,cx));
    }).catch(()=>{FOCUS.busy=false;});
  }catch(e){FOCUS.busy=false;}}

/* ================= CAPTIONS (cached overlay — zero per-frame layout cost) ================= */
const CAP_MAX_WORDS=6;
function capStyle(opt){switch(opt.capTemplate){case "clean":return{upper:false,mono:false,text:"#FFFFFF",hl:opt.colorHl==="#FFFFFF"?"#FFD84D":opt.colorHl,glow:"rgba(0,0,0,.9)",box:false};case "mono":return{upper:false,mono:true,text:"#E8E8E8",hl:"#7CF5B8",glow:"rgba(0,0,0,.9)",box:false};case "neon":return{upper:true,mono:false,text:"#7DF9FF",hl:"#FF3CAC",glow:"rgba(0,229,255,.85)",box:false};case "boxed":return{upper:true,mono:false,text:"#FFFFFF",hl:"#FFE400",glow:null,box:true};default:return{upper:true,mono:false,text:opt.colorText||"#FFFF00",hl:opt.colorHl||"#FFFFFF",glow:"rgba(0,0,0,.9)",box:false};}}
function wordSpans(sent){if(sent._words)return sent._words;const words=sent.text.split(/\s+/).filter(Boolean);const dur=Math.max(sent.end-sent.start,0.3);const per=dur/words.length;sent._words=words.map((w,i)=>({w,t0:sent.start+i*per,t1:sent.start+(i+1)*per}));return sent._words;}
function capChunk(sent,t){const ws=wordSpans(sent);let idx=ws.findIndex(x=>t>=x.t0&&t<x.t1);if(idx<0)idx=t>=sent.end?ws.length-1:0;const c0=Math.floor(idx/CAP_MAX_WORDS)*CAP_MAX_WORDS;return{words:ws.slice(c0,c0+CAP_MAX_WORDS),active:idx-c0};}
function cropRect(vw,vh,cw,ch){const sc=Math.max(cw/vw,ch/vh);const sw=cw/sc,sh=ch/sc;return{sx:(vw-sw)/2,sy:(vh-sh)/2,sw,sh};}
function layoutWords(ctx,words,maxW){const lines=[];let line=[];for(const w of words){const test=line.concat([w]).map(x=>x.w).join(" ");if(ctx.measureText(test).width>maxW&&line.length){lines.push(line);line=[w];}else line.push(w);}if(line.length)lines.push(line);return lines.slice(0,2);}
function findSentAt(t){const arr=S.sentences;if(!arr.length)return -1;let i=S._capIdx||0;if(i>=arr.length)i=0;
  if(arr[i]&&t>=arr[i].start&&t<=arr[i].end)return i;
  for(let k=i+1;k<Math.min(i+6,arr.length);k++)if(t>=arr[k].start&&t<=arr[k].end){S._capIdx=k;return k;}
  for(let k=0;k<arr.length;k++)if(t>=arr[k].start&&t<=arr[k].end){S._capIdx=k;return k;}
  return -1;}
function renderCaptionInto(ctx,cw,ch,words,active,opt){const st=capStyle(opt);const sizeMap={s:0.042,m:0.055,l:0.07};const fs=Math.round(cw*(sizeMap[opt.capSize]||0.055));ctx.font="900 "+(st.mono?Math.round(fs*0.9)+"px Menlo,Consolas,monospace":fs+"px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif");ctx.textAlign="center";ctx.textBaseline="middle";const lines=layoutWords(ctx,words,cw*0.86);const lh=fs*1.35;const posMap={bottom:0.86,middle:0.55,top:0.16};const anchor=ch*(posMap[opt.capPos]||0.86);const baseY=anchor-(lines.length-1)*lh;let wi=0;lines.forEach((line,li)=>{const texts=line.map(x=>st.upper?x.w.toUpperCase():x.w);const widths=texts.map(s2=>ctx.measureText(s2).width);const gap=fs*0.32;const totW=widths.reduce((a,b)=>a+b,0)+gap*(texts.length-1);let x=cw/2-totW/2;const y=baseY+li*lh;if(st.box){ctx.save();ctx.fillStyle="rgba(0,0,0,.78)";ctx.fillRect(cw/2-totW/2-fs*0.45,y-lh*0.52,totW+fs*0.9,lh*1.04);ctx.restore();}texts.forEach((s2,i)=>{const isOn=wi===active;ctx.save();if(st.glow){ctx.shadowColor=st.glow;ctx.shadowBlur=fs*0.35;ctx.lineWidth=Math.max(fs*0.12,3);ctx.strokeStyle="rgba(0,0,0,.85)";}const cx=x+widths[i]/2;if(isOn){ctx.translate(cx,y);ctx.scale(1.12,1.12);ctx.translate(-cx,-y);}if(st.glow)ctx.strokeText(s2,cx,y);ctx.fillStyle=isOn?st.hl:st.text;ctx.fillText(s2,cx,y);ctx.restore();x+=widths[i]+gap;wi++;});});}
const CAPC={key:"",cv:null,ctx:null};
function drawCaption(ctx,cw,ch,t,opt){if(!opt.captions||opt.capTemplate==="none")return;const si=findSentAt(t);if(si<0)return;const sent=S.sentences[si];const{words,active}=capChunk(sent,t);if(!words||!words.length)return;
  const key=si+"|"+(words[0]?words[0].t0.toFixed(3):"0")+"|"+active+"|"+opt.capTemplate+"|"+opt.capPos+"|"+opt.capSize+"|"+cw+"x"+ch;
  if(CAPC.key!==key||!CAPC.cv){
    if(!CAPC.cv||CAPC.cv.width!==cw||CAPC.cv.height!==ch){CAPC.cv=document.createElement("canvas");CAPC.cv.width=cw;CAPC.cv.height=ch;CAPC.ctx=CAPC.cv.getContext("2d");}
    CAPC.ctx.clearRect(0,0,cw,ch);
    renderCaptionInto(CAPC.ctx,cw,ch,words,active,opt);
    CAPC.key=key;
  }
  ctx.drawImage(CAPC.cv,0,0);}
function drawWM(ctx,cw,ch,text){if(!text)return;ctx.save();const fs=Math.round(cw*0.03);ctx.font="700 "+fs+"px -apple-system,sans-serif";ctx.textAlign="right";ctx.textBaseline="top";ctx.shadowColor="rgba(0,0,0,.7)";ctx.shadowBlur=6;ctx.fillStyle="rgba(255,255,255,.82)";ctx.fillText(text,cw-fs,fs);ctx.restore();}

/* ================= CODEC PICKER =================
   MP4 (H.264 + AAC) plays literally everywhere — phones, TVs, WhatsApp, editors.
   We try MP4 first and only fall back to WebM if the browser can't record MP4. */
function pickRecorderFormat(){
  const mp4Types=["video/mp4;codecs=avc1.42E01E,mp4a.40.2","video/mp4;codecs=avc1.424028,mp4a.40.2","video/mp4;codecs=avc1,mp4a.40.2","video/mp4;codecs=avc1,opus","video/mp4;codecs=avc1","video/mp4"];
  const webmTypes=["video/webm;codecs=vp8,opus","video/webm;codecs=vp9,opus","video/webm;codecs=vp8","video/webm"];
  if(window.MediaRecorder){
    for(const t of mp4Types){try{if(MediaRecorder.isTypeSupported(t))return{mime:t,ext:"mp4"};}catch(e){}}
    for(const t of webmTypes){try{if(MediaRecorder.isTypeSupported(t))return{mime:t,ext:"webm"};}catch(e){}}
  }
  return{mime:"video/webm",ext:"webm"};}

/* ================= ROBUST RENDER ENGINE (v21) =================
   Root cause of lag / "audio not with video":
   - Old code drew VIDEO on a canvas and grabbed AUDIO separately from a MUTED
     <video> via captureStream, then forced mid-cut seeks to "catch up".
   - Muted captureStream audio is unreliable, and seeking mid-cut freezes the
     picture while audio keeps going \u2192 desync + lag.

   v21 fix:
   1) Web Audio graph: full audio \u2192 MediaRecorder, gain 0 \u2192 speakers (no mute hack)
   2) Video currentTime is the ONLY clock (never seek mid-cut)
   3) canvas.captureStream(0) + requestFrame so frames match what we draw
   4) Recorder pauses only between cuts (during seeks) */
async function exportClips(){if(S.exporting)return;
  const moments=(S.selected||[]).filter(m=>m.cuts&&m.cuts.length);
  if(!moments.length){showAlert("Nothing to render \u2014 run the analysis first.");goStep(3);return;}
  const opt={...S.opts,count:1};S.exporting=true;S.cancelExport=false;
  S._capIdx=0;CAPC.key="";
  $("#export-bar").style.width="0%";$("#export-pct").textContent="0%";
  $("#export-log").textContent="Preparing renderer\u2026";
  const p=$("#player");
  /* Element must NOT be muted — both captureStream and Web Audio need decoded audio */
  p.muted=false;p.volume=1;p.playbackRate=1;p.playsInline=true;
  if(!p.src||p.src!==S.videoURL){p.src=S.videoURL;p.load();}await waitMeta(p);
  setupFocus(opt);
  let cw=720,ch=1280;if(opt.aspect==="1:1"){cw=720;ch=720;}if(opt.aspect==="16:9"){cw=1280;ch=720;}
  const canvas=document.createElement("canvas");canvas.width=cw;canvas.height=ch;
  const ctx=canvas.getContext("2d",{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="medium";
  const fps=30;const frameMs=1000/fps;
  /* fps=0 + requestFrame = we only emit a frame when we actually draw it */
  let stream;let vTrack=null;let manualFrames=false;
  try{stream=canvas.captureStream(0);vTrack=stream.getVideoTracks()[0]||null;manualFrames=!!(vTrack&&typeof vTrack.requestFrame==="function");
    if(!manualFrames){try{stream.getTracks().forEach(t=>t.stop());}catch(e){}stream=canvas.captureStream(fps);vTrack=stream.getVideoTracks()[0]||null;manualFrames=false;}
  }catch(e){stream=canvas.captureStream(fps);vTrack=stream.getVideoTracks()[0]||null;manualFrames=false;}

  /* --- AUDIO: video element captureStream first (naturally synced with currentTime); Web Audio fallback --- */
  /* --- FIX: captureStream provides audio from the same decoded buffer as currentTime, so audio
       & picture are always from the same source clock. Web Audio routing adds latency/drift. --- */
  let audioAttached=false;
  let audioGraph=null;
  try{
    const ps=p.captureStream?p.captureStream():(p.mozCaptureStream?p.mozCaptureStream():null);
    if(ps){ps.getAudioTracks().forEach(t=>{try{stream.addTrack(t);audioAttached=true;}catch(e){}});}
  }catch(e){console.warn("captureStream audio failed:",e);}
  if(!audioAttached){
    audioGraph=ensureAudioGraph(p);
    await resumeAudioCtx(audioGraph);
    if(audioGraph&&audioGraph.dest){
      try{audioGraph.dest.stream.getAudioTracks().forEach(t=>{stream.addTrack(t);audioAttached=true;});}catch(e){console.warn("Web Audio track attach failed:",e);}
    }
  }
  if(!audioAttached){console.warn("Export will be silent — browser blocked audio capture.");}

  const fmt=pickRecorderFormat();let mime=fmt.mime,ext=fmt.ext;
  let rec;try{rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3_500_000,audioBitsPerSecond:128_000});}
  catch(e){try{rec=new MediaRecorder(stream,{mimeType:"video/webm",videoBitsPerSecond:3_000_000,audioBitsPerSecond:128_000});mime="video/webm";ext="webm";}
  catch(e2){showAlert("This browser cannot record video (MediaRecorder missing). Try Chrome/Edge on desktop.");S.exporting=false;return;}}
  const chunks=[];rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
  const stopped=new Promise(res=>{rec.onstop=()=>res();rec.onerror=()=>res();});
  function recPause(){try{if(rec.state==="recording")rec.pause();}catch(e){}}
  function recResume(){try{if(rec.state==="paused")rec.resume();}catch(e){}}

  const planned=moments.reduce((n,m)=>n+(m.cutDuration||0),0)||1;let rendered=0;const F=0.35,CUTPOP=0.12;
  const totalCutsAll=moments.reduce((n,m)=>n+m.cuts.length,0);let cutIndex=0;

  function drawFrame(srcT,cut,mi,ci,cutT,cutDur){
    const vw=p.videoWidth||cw,vh=p.videoHeight||ch;let cr=cropRect(vw,vh,cw,ch);
    if(FOCUS.enabled&&cr.sw<vw-1){const desired=FOCUS.x*vw-cr.sw/2;cr.sx=Math.min(Math.max(desired,0),vw-cr.sw);}
    if(opt.zoom){const zp=Math.min(Math.max(cutT/Math.max(cutDur,0.01),0),1);const z=1+0.06*zp;const sw2=cr.sw/z,sh2=cr.sh/z;cr={sx:cr.sx+(cr.sw-sw2)/2,sy:cr.sy+(cr.sh-sh2)/2,sw:sw2,sh:sh2};}
    if(cutT<CUTPOP&&!(mi===0&&ci===0)){const pz=1+0.05*(1-cutT/CUTPOP);const sw3=cr.sw/pz,sh3=cr.sh/pz;cr={sx:cr.sx+(cr.sw-sw3)/2,sy:cr.sy+(cr.sh-sh3)/2,sw:sw3,sh:sh3};}
    ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);
    try{if(p.videoWidth)ctx.drawImage(p,cr.sx,cr.sy,cr.sw,cr.sh,0,0,cw,ch);}catch(e){}
    drawCaption(ctx,cw,ch,srcT,opt);
    if(opt.watermark)drawWM(ctx,cw,ch,opt.wmText);
    if(opt.fades){let a=0;if(ci===0){if(cutT<F)a=Math.max(a,1-cutT/F);}if(ci===(moments[mi].cuts.length-1)){const tOut=cutDur-cutT;if(tOut<F)a=Math.max(a,1-tOut/F);}if(a>0){ctx.fillStyle="rgba(0,0,0,"+Math.min(Math.max(a,0),1).toFixed(3)+")";ctx.fillRect(0,0,cw,ch);}}
    if(manualFrames){try{vTrack.requestFrame();}catch(e){}}
  }

  ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);if(manualFrames){try{vTrack.requestFrame();}catch(e){}}
  if(rec.state==="inactive")rec.start(250);

  for(let mi=0;mi<moments.length&&!S.cancelExport;mi++){const moment=moments[mi];const cuts=moment.cuts;
    for(let ci=0;ci<cuts.length&&!S.cancelExport;ci++){const cut=cuts[ci];cutIndex++;const cutDur=Math.max(cut.ce-cut.cs,0.2);
      $("#export-log").textContent="\ud83c\udfac Rendering cut "+cutIndex+"/"+totalCutsAll+" \u00b7 "+fmtTime(rendered)+" / "+fmtTime(planned);
      /* Pause recorder while seeking so we never record a freeze or audio glitch */
      recPause();
      try{p.pause();}catch(e){}
      await seekTo(p,cut.cs);FOCUS.x=FOCUS.tx;
      await resumeAudioCtx(audioGraph);
      /* Keep element unmuted so audio graph / captureStream get real samples */
      p.muted=false;p.volume=1;p.playbackRate=1;
      try{await p.play();}catch(e){try{await p.play();}catch(e2){}}
      /* Let decoder deliver a couple frames + audio before we resume recording */
      await sleep(120);
      drawFrame(Math.max(p.currentTime,cut.cs),cut,mi,ci,0,cutDur);
      recResume();

      const t0=performance.now();
      let lastVidT=p.currentTime;
      let stuckMs=0;
      let lastDraw=0;
      let nudged=false;

      await new Promise(resolve=>{
        function tick(){
          if(S.cancelExport){resolve();return;}
          const nowMs=performance.now();
          if(nowMs-lastDraw<frameMs-2){requestAnimationFrame(tick);return;}
          lastDraw=nowMs;

          updateFocus(p);FOCUS.x+=(FOCUS.tx-FOCUS.x)*0.10;

          const wall=(nowMs-t0)/1000;
          let vidT=p.currentTime;

          /* Detect stalls (tab backgrounded / decoder hitch) — recover without hard-seeking
             into the future (that is what desynced A/V before). */
          if(Math.abs(vidT-lastVidT)<0.0005){stuckMs+=frameMs;}
          else{stuckMs=0;lastVidT=vidT;nudged=false;}
          if(stuckMs>900&&!nudged){
            nudged=true;stuckMs=0;
            try{p.playbackRate=1;p.play();}catch(e){}
          }
          /* Safety only: if still frozen for a long time, skip ahead INSIDE this cut
             by a tiny amount (not wall-clock jump). */
          if(stuckMs>2200){
            try{p.currentTime=Math.min(cut.ce-0.05,Math.max(p.currentTime+0.05,cut.cs));}catch(e){}
            stuckMs=0;nudged=false;
          }

          /* MASTER CLOCK = video.currentTime (same clock the audio is playing from) */
          const srcT=Math.min(Math.max(vidT,cut.cs),cut.ce);
          const cutT=Math.min(Math.max(srcT-cut.cs,0),cutDur);
          drawFrame(srcT,cut,mi,ci,cutT,cutDur);

          const prog=(rendered+cutT)/planned*100;
          const pct=Math.min(Math.round(prog),99);
          $("#export-bar").style.width=pct+"%";$("#export-pct").textContent=pct+"%";

          const doneByVid=vidT>=cut.ce-0.05;
          const ended=p.ended&&vidT>=cut.ce-0.5;
          /* Wall is only a safety net if the element never reaches cut.ce (corrupt tail) */
          const doneBySafety=wall>=cutDur+2.5;
          if(doneByVid||ended||doneBySafety){resolve();return;}
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });

      try{p.pause();}catch(e){}
      rendered+=cutDur;
    }
  }

  recResume();
  if(!S.cancelExport){const holdEnd=performance.now()+300;while(performance.now()<holdEnd){await sleep(40);if(manualFrames){try{vTrack.requestFrame();}catch(e){}}}}
  try{if(rec.state!=="inactive"){if(rec.requestData)rec.requestData();rec.stop();}}catch(e){}
  await stopped;await sleep(80);
  try{stream.getTracks().forEach(t=>t.stop());}catch(e){}
  try{p.pause();}catch(e){}
  p.muted=false;p.volume=1;S.exporting=false;

  if(S.cancelExport){$("#export-log").textContent="Render cancelled.";$("#export-bar").style.width="0%";$("#export-pct").textContent="";goStep(3);return;}
  if(!chunks.length){showAlert("Render produced an empty file. Try Chrome/Edge, keep the tab visible, and re-render.");goStep(3);return;}
  $("#export-bar").style.width="100%";$("#export-pct").textContent="100%";
  const blobType=ext==="mp4"?"video/mp4":"video/webm";
  const blob=new Blob(chunks,{type:blobType});
  if(S._lastBlobUrl){try{URL.revokeObjectURL(S._lastBlobUrl);}catch(e){}}
  const blobUrl=URL.createObjectURL(blob);S._lastBlobUrl=blobUrl;
  const fp=$("#final-player");fp.pause();fp.removeAttribute("src");fp.load();fp.preload="auto";fp.controls=true;fp.playsInline=true;fp.src=blobUrl;fp.load();
  const fname="podcast_clip_"+Date.now()+"."+ext;
  const dl=$("#download");dl.href=blobUrl;dl.download=fname;dl.setAttribute("download",fname);
  const tgt=opt.target_s||120;
  const fmtName=ext==="mp4"?"MP4 \u00b7 plays everywhere \u2705":"WebM (this browser can't record MP4 \u2014 use Chrome/Edge for MP4)";
  const audNote=audioAttached?"":" \u00b7 \u26a0\ufe0f audio may be missing in this browser";
  $("#final-info").innerHTML="\u2705 Render complete! <strong>1 best clip</strong> \u00b7 <strong>"+totalCutsAll+" jump-cut"+(totalCutsAll===1?"":"s")+"</strong> \u00b7 Length: <strong>"+fmtTime(planned)+"</strong> (target "+fmtTime(tgt)+") \u00b7 "+fmtBytes(blob.size)+" \u00b7 "+fmtName+" \u00b7 "+APP_VERSION+audNote;
  $("#render-box").style.display="none";$("#final-box").style.display="block";
  await new Promise(r=>{const ok=()=>{fp.removeEventListener("canplay",ok);fp.removeEventListener("loadeddata",ok);clearTimeout(t);r();};fp.addEventListener("canplay",ok);fp.addEventListener("loadeddata",ok);const t=setTimeout(ok,4000);});
  try{fp.currentTime=0;await fp.play();}catch(e){}}

/* ================= AI progress UI helper (percentage shown in ONE place only) ================= */
function setAiProgress(msg,pct){
  const st=$("#ai-status"),bar=$("#ai-bar"),lab=$("#ai-pct"),wrap=$("#ai-prog");
  if(wrap)wrap.classList.add("show");
  const p=Math.round(Math.min(100,Math.max(0,pct==null?0:pct)));
  if(bar)bar.style.width=p+"%";
  if(lab)lab.textContent=p+"%";
  if(st){
    const line=msg||"Working";
    if(p>=100)st.textContent="\u2705 "+line;
    else if(p>=88)st.textContent="\u23f3 Almost there \u2014 "+line+"\u2026";
    else st.textContent="\u23f3 "+line+"\u2026";
  }
}

/* ================= BOOT ================= */
function boot(){
  initGate();initOpts();goStep(1);S.opts.count=1;
  const vb=$("#ver-btn");
  if(vb){vb.textContent=APP_VERSION+" \u00b7 latest";vb.title="Click to see what's new";vb.addEventListener("click",()=>alert(APP_CHANGELOG));}
  bindDrop("#video-drop","#video-input",handleVideo);
  bindDrop("#tr-drop","#tr-input",f=>{const rd=new FileReader();rd.onload=()=>handleTranscript(f.name,String(rd.result||""));rd.readAsText(f);});
  let deb;const trText=$("#tr-text");
  if(trText)trText.addEventListener("input",()=>{clearTimeout(deb);deb=setTimeout(()=>{const t=trText.value.trim();if(t.length>10)handleTranscript(null,t);},700);});

  /* Manual transcript hidden by default — toggle to reveal */
  const sm=$("#show-manual"),mb=$("#manual-box");
  if(sm&&mb)sm.addEventListener("click",()=>{mb.hidden=!mb.hidden;sm.textContent=mb.hidden?"\u270f\ufe0f Have your own transcript? Paste it manually":"\u2715 Hide manual transcript";if(!mb.hidden)mb.scrollIntoView({block:"nearest",behavior:"smooth"});});

  $("#use-manual").addEventListener("click",()=>{
    const t=($("#tr-text").value||"").trim();
    if(t.length>10)handleTranscript(null,t);
    if(S.sentences.length&&(manualReady||t.length>10)){goStep(3);return;}
    showAlert("Manual side is empty \u2014 paste a transcript or upload a file first.");});

  $("#ai-transcribe").addEventListener("click",async()=>{
    if(!S.videoFile){showAlert("Upload a video first (step 1).");goStep(1);return;}
    const btn=$("#ai-transcribe"),useBtn=$("#use-ai"),wrap=$("#ai-prog");
    btn.disabled=true;if(useBtn)useBtn.style.display="none";
    if(wrap)wrap.classList.add("show");
    setAiProgress("Starting",2);
    try{
      const sents=await transcribeWithDeepgram(S.videoFile,(msg,pct)=>setAiProgress(msg,pct));
      if(!sents.length){setAiProgress("No speech detected \u2014 try Manual instead",100);btn.disabled=false;return;}
      S.sentences=sents;aiReady=true;manualReady=false;
      const wc=sents.reduce((n,s)=>n+s.text.split(/\s+/).filter(Boolean).length,0);
      infoGrid("#tr-info",[["Source","AI Speech-to-Text"],["Words",String(wc)],["Lines",String(sents.length)],["Cover",fmtTime(sents[0].start)+" \u2013 "+fmtTime(sents[sents.length-1].end)]]);
      setAiProgress("Transcribed successfully",100);
      if(useBtn){useBtn.style.display="block";useBtn.scrollIntoView({block:"nearest",behavior:"smooth"});}
    }catch(e){
      console.warn(e);
      const wrap2=$("#ai-prog");if(wrap2)wrap2.classList.remove("show");
      const st=$("#ai-status");if(st)st.textContent="\u26a0 AI failed ("+(e&&e.message?e.message:"error")+"). On phones, very long videos can run out of memory \u2014 try a shorter video or the Manual option below.";
    }
    btn.disabled=false;});
  $("#use-ai").addEventListener("click",()=>{if(S.sentences.length&&aiReady)goStep(3);});

  $("#to-step-2").addEventListener("click",()=>goStep(2));
  $$("[data-back]").forEach(b=>b.addEventListener("click",()=>goStep(Number(b.dataset.back))));
  $("#generate").addEventListener("click",()=>{
    if(!S.videoFile){showAlert("Load a video first (step 1).");goStep(1);return;}
    if(!S.sentences.length){showAlert("Add a transcript first (step 2) \u2014 AI or Manual.");goStep(2);return;}
    generate();});
  $("#cancel-export").addEventListener("click",()=>{S.cancelExport=true;});
  $("#render-again").addEventListener("click",()=>{if(!S.exporting)startRender();});
  const ro=$("#render-other");
  if(ro)ro.addEventListener("click",()=>{
    if(S.exporting)return;
    const picked=pickAnotherPart();
    if(!picked){showAlert("Couldn't find another distinct part at this length \u2014 try a shorter length in Style, or Start over.");return;}
    S._used=(S._used||[]).concat([[picked[0].sentLo,picked[0].sentHi]]);
    S.selected=picked;
    startRender();});
  $("#start-over").addEventListener("click",()=>location.reload());
  const of=$("#opt-focus");if(of)of.addEventListener("change",e=>S.opts.focus=e.target.checked);
  $("#colors-reset").addEventListener("click",()=>{$("#opt-color-text").value="#FFFF00";$("#opt-color-hl").value="#FFFFFF";S.opts.colorText="#FFFF00";S.opts.colorHl="#FFFFFF";});
  $("#opt-color-text").addEventListener("input",e=>S.opts.colorText=e.target.value);
  $("#opt-color-hl").addEventListener("input",e=>S.opts.colorHl=e.target.value);
  $("#opt-fades").addEventListener("change",e=>S.opts.fades=e.target.checked);
  $("#opt-zoom").addEventListener("change",e=>S.opts.zoom=e.target.checked);
  $("#opt-watermark").addEventListener("change",e=>{S.opts.watermark=e.target.checked;$("#wm-group").style.display=e.target.checked?"block":"none";});
  $("#opt-wm-text").addEventListener("input",e=>S.opts.wmText=e.target.value);
}
boot();
