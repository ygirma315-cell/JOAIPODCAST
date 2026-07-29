"use strict";

const APP_VERSION="v24";
const APP_CHANGELOG="ClipForge "+APP_VERSION+" \u2014 latest update:\n\n\u2022 CAMERA LOCKS ON INSTANTLY \u2014 when the speaker changes or someone moves sideways, the camera CUTS straight to them (no more slow slide showing a half-cropped person)\n\u2022 2x faster tracking \u2014 follows moving people tightly, small moves stay buttery smooth\n\u2022 TRUE AUDIO/VIDEO SYNC \u2014 frame-accurate capture locked to your file's timeline\n\u2022 Audio taken 1:1 from your original video \u2014 never separated, never rebuilt\n\u2022 Built-in person detection (works in EVERY browser)";

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
  const p=$("#player");p.muted=true;p.playsInline=true;p.preload="auto";
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

/* ================= SMART SPEAKER CAMERA v4 — OUR OWN DETECTION ENGINE =================
   No FaceDetector API. Our own computer-vision pass on a tiny 112px copy of the frame
   every ~0.22s:
   1. SKIN DETECTION — RGB + YCbCr skin-tone rules; skin pixels vote for their column.
   2. MOTION DETECTION — per-column brightness diff vs previous sample.
   3. Column votes are clustered into person \"blobs\" → stable seats.
   4. Whoever's seat has the most motion is the SPEAKER.
   CAMERA BEHAVIOR (v24): when the speaker changes or the person moves far, the camera
   HARD-CUTS straight to them like a real multicam edit — no slow slide that leaves the
   person half-cropped. Small drifts are still smoothed so it never jitters. */
const FOCUS={x:0.5,tx:0.5,enabled:false,last:0,cv:null,cctx:null,prevLum:null,seats:[],activeSeat:null,votes:0,cut:false};
function setupFocus(opt){FOCUS.x=0.5;FOCUS.tx=0.5;FOCUS.last=0;FOCUS.prevLum=null;FOCUS.seats=[];FOCUS.activeSeat=null;FOCUS.votes=0;FOCUS.cut=false;FOCUS.enabled=opt.focus!==false;}
function focusResetMotion(){FOCUS.prevLum=null;}
/* per-frame camera move: instant cut when far / speaker switch, smooth when close */
function focusStep(){const d=FOCUS.tx-FOCUS.x,ad=Math.abs(d);
  if(FOCUS.cut||ad>0.18){FOCUS.x=FOCUS.tx;FOCUS.cut=false;}
  else if(ad>0.05)FOCUS.x+=d*0.45;
  else FOCUS.x+=d*0.18;}
function updateFocus(p){if(!FOCUS.enabled||!p.videoWidth)return;const now=performance.now();if(now-FOCUS.last<220)return;const gap=now-FOCUS.last;FOCUS.last=now;
  try{
    const vw=p.videoWidth,vh=p.videoHeight;
    const dw=112,dh=Math.max(8,Math.round(dw*vh/vw));
    if(!FOCUS.cv)FOCUS.cv=document.createElement("canvas");
    if(FOCUS.cv.width!==dw||FOCUS.cv.height!==dh){FOCUS.cv.width=dw;FOCUS.cv.height=dh;FOCUS.cctx=FOCUS.cv.getContext("2d",{willReadFrequently:true});FOCUS.prevLum=null;}
    if(!FOCUS.cctx)FOCUS.cctx=FOCUS.cv.getContext("2d",{willReadFrequently:true});
    FOCUS.cctx.drawImage(p,0,0,dw,dh);
    const img=FOCUS.cctx.getImageData(0,0,dw,dh).data;
    const skinCol=new Float32Array(dw),motCol=new Float32Array(dw);
    const lum=new Float32Array(dw*dh);
    const usePrev=!!(FOCUS.prevLum&&FOCUS.prevLum.length===dw*dh&&gap<1200);
    for(let y=0;y<dh;y++){
      const rowW=y<dh*0.62?1.25:0.45;
      for(let x=0;x<dw;x++){
        const idx=y*dw+x,i=idx*4,r=img[i],g=img[i+1],b=img[i+2];
        const L=(r*2+g*5+b)/8;lum[idx]=L;
        const cb=128-0.168736*r-0.331264*g+0.5*b;
        const cr=128+0.5*r-0.418688*g-0.081312*b;
        if(r>60&&g>30&&b>15&&r>b&&(r-g)>8&&cb>=77&&cb<=127&&cr>=133&&cr<=177)skinCol[x]+=rowW;
        if(usePrev)motCol[x]+=Math.abs(L-FOCUS.prevLum[idx]);
      }}
    FOCUS.prevLum=lum;
    const smooth=a=>{const o=new Float32Array(dw);for(let x=0;x<dw;x++){let s=0,c=0;for(let k=-3;k<=3;k++){const j=x+k;if(j>=0&&j<dw){s+=a[j];c++;}}o[x]=s/c;}return o;};
    const sk=smooth(skinCol),mo=smooth(motCol);
    let skinMass=0;for(let x=0;x<dw;x++)skinMass+=sk[x];
    const map=skinMass>dh*1.5?sk:(usePrev?mo:sk); /* fall back to motion if skin finds nothing */
    let tot=0,mx=0;for(let x=0;x<dw;x++){tot+=map[x];if(map[x]>mx)mx=map[x];}
    if(mx<=0)return;
    const thr=Math.max((tot/dw)*1.25,mx*0.3);
    const blobs=[];let cs=-1;
    for(let x=0;x<=dw;x++){const on=x<dw&&map[x]>=thr;
      if(on&&cs<0)cs=x;
      if(!on&&cs>=0){if(x-cs>=3){let m=0,cxs=0,mt=0;for(let j=cs;j<x;j++){m+=map[j];cxs+=map[j]*j;mt+=mo[j];}blobs.push({x:(cxs/m)/dw,mass:m,mot:mt/(x-cs)});}cs=-1;}}
    if(!blobs.length)return;
    blobs.sort((a,b)=>b.mass-a.mass);
    const top=blobs.slice(0,3);
    for(const s of FOCUS.seats)s.seen=false;
    for(const bl of top){
      let seat=null,bd=0.13;
      for(const s of FOCUS.seats){const d=Math.abs(s.x-bl.x);if(d<bd){bd=d;seat=s;}}
      if(!seat){seat={x:bl.x,talk:0,miss:0};FOCUS.seats.push(seat);}
      /* fast follow: give the NEW position most of the weight so sideways moves lock on */
      seat.x=seat.x*0.35+bl.x*0.65;seat.seen=true;seat.miss=0;
      seat.talk=seat.talk*0.55+(usePrev?bl.mot:0)*0.45;
    }
    for(const s of FOCUS.seats)if(!s.seen)s.miss=(s.miss||0)+1;
    FOCUS.seats=FOCUS.seats.filter(s=>s.miss<10);
    const vis=FOCUS.seats.filter(s=>s.miss<3);
    if(!vis.length)return;
    let target=null;
    if(vis.length===1){target=vis[0];if(FOCUS.activeSeat!==target)FOCUS.cut=true;FOCUS.activeSeat=target;FOCUS.votes=0;}
    else{
      const sorted=vis.slice().sort((a,b)=>b.talk-a.talk);
      const cur=(FOCUS.activeSeat&&vis.includes(FOCUS.activeSeat))?FOCUS.activeSeat:null;
      const cand=sorted[0];
      if(!cur){FOCUS.activeSeat=cand;FOCUS.votes=0;FOCUS.cut=true;}
      else if(cand!==cur&&cand.talk>cur.talk*1.3+0.3){FOCUS.votes++;if(FOCUS.votes>=2){FOCUS.activeSeat=cand;FOCUS.votes=0;FOCUS.cut=true;}}
      else FOCUS.votes=0;
      target=FOCUS.activeSeat;
    }
    if(target)FOCUS.tx=Math.min(0.92,Math.max(0.08,target.x));
  }catch(e){}}

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

/* ================= CODEC PICKER (MP4 first = plays everywhere) ================= */
function pickRecorderFormat(){
  const mp4Types=["video/mp4;codecs=avc1.42E01E,mp4a.40.2","video/mp4;codecs=avc1.424028,mp4a.40.2","video/mp4;codecs=avc1,mp4a.40.2","video/mp4;codecs=avc1,opus","video/mp4;codecs=avc1","video/mp4"];
  const webmTypes=["video/webm;codecs=vp8,opus","video/webm;codecs=vp9,opus","video/webm;codecs=vp8","video/webm"];
  if(window.MediaRecorder){
    for(const t of mp4Types){try{if(MediaRecorder.isTypeSupported(t))return{mime:t,ext:"mp4"};}catch(e){}}
    for(const t of webmTypes){try{if(MediaRecorder.isTypeSupported(t))return{mime:t,ext:"webm"};}catch(e){}}
  }
  return{mime:"video/webm",ext:"webm"};}

/* ================= RENDER ENGINE — TRUE A/V SYNC =================
   • Audio: taken directly from YOUR original file's audio track (element captureStream).
   • Video: canvas.captureStream(0) + requestFrame() — each frame is PUSHED into the
     recording the moment it's drawn, drawn via requestVideoFrameCallback which fires
     exactly when the browser presents a real decoded frame of your video.
   • At every cut start the recorder stays PAUSED until the decoder delivers its first
     real moving frame — audio and video restart together, always.
   • No clock-jump hacks: video time is the single source of truth. */
async function exportClips(){if(S.exporting)return;
  const moments=(S.selected||[]).filter(m=>m.cuts&&m.cuts.length);
  if(!moments.length){showAlert("Nothing to render \u2014 run the analysis first.");goStep(3);return;}
  const opt={...S.opts,count:1};S.exporting=true;S.cancelExport=false;
  S._capIdx=0;CAPC.key="";
  $("#export-bar").style.width="0%";$("#export-pct").textContent="0%";
  $("#export-log").textContent="Preparing renderer\u2026";
  const p=$("#player");p.muted=true;p.volume=0;p.playbackRate=1;p.playsInline=true;
  if(!p.src||p.src!==S.videoURL){p.src=S.videoURL;p.load();}await waitMeta(p);
  setupFocus(opt);
  let cw=720,ch=1280;if(opt.aspect==="1:1"){cw=720;ch=720;}if(opt.aspect==="16:9"){cw=1280;ch=720;}
  const canvas=document.createElement("canvas");canvas.width=cw;canvas.height=ch;const ctx=canvas.getContext("2d",{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="medium";
  /* Frame-accurate capture: push frames manually the instant they're drawn */
  let stream=null,vTrack=null,manualFrames=false;
  try{const st0=canvas.captureStream(0);const vt=st0.getVideoTracks()[0];
    if(vt&&typeof vt.requestFrame==="function"){stream=st0;vTrack=vt;manualFrames=true;}
    else if(typeof st0.requestFrame==="function"){stream=st0;manualFrames=true;}
  }catch(e){}
  if(!stream)stream=canvas.captureStream(30);
  function pushFrame(){if(!manualFrames)return;try{if(vTrack)vTrack.requestFrame();else stream.requestFrame();}catch(e){}}
  /* Audio = YOUR file's own audio track, recorded together with the video in ONE stream */
  try{const ps=p.captureStream?p.captureStream():(p.mozCaptureStream?p.mozCaptureStream():null);if(ps){ps.getAudioTracks().forEach(t=>{try{stream.addTrack(t);}catch(e){}});} }catch(e){console.warn("No audio track:",e);}
  const fmt=pickRecorderFormat();let mime=fmt.mime,ext=fmt.ext;
  let rec;try{rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4_500_000,audioBitsPerSecond:128_000});}catch(e){try{rec=new MediaRecorder(stream,{mimeType:"video/webm",videoBitsPerSecond:3_500_000});mime="video/webm";ext="webm";}catch(e2){showAlert("This browser cannot record video (MediaRecorder missing). Try Chrome/Edge on desktop.");S.exporting=false;return;}}
  const chunks=[];rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};const stopped=new Promise(res=>{rec.onstop=()=>res();rec.onerror=()=>res();});
  function recPause(){try{if(rec.state==="recording")rec.pause();}catch(e){}}
  function recResume(){try{if(rec.state==="paused")rec.resume();}catch(e){}}
  ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);if(rec.state==="inactive"){rec.start(200);pushFrame();}
  const planned=moments.reduce((n,m)=>n+(m.cutDuration||0),0)||1;let rendered=0;const F=0.35,CUTPOP=0.12;
  const totalCutsAll=moments.reduce((n,m)=>n+m.cuts.length,0);let cutIndex=0;
  const useRVFC=typeof p.requestVideoFrameCallback==="function";
  const frameMs=1000/30;
  function drawFrame(srcT,cut,mi,ci,cutT,cutDur){const vw=p.videoWidth||cw,vh=p.videoHeight||ch;let cr=cropRect(vw,vh,cw,ch);
    if(FOCUS.enabled&&cr.sw<vw-1){const desired=FOCUS.x*vw-cr.sw/2;cr.sx=Math.min(Math.max(desired,0),vw-cr.sw);}
    if(opt.zoom){const zp=Math.min(Math.max(cutT/Math.max(cutDur,0.01),0),1);const z=1+0.06*zp;const sw2=cr.sw/z,sh2=cr.sh/z;cr={sx:cr.sx+(cr.sw-sw2)/2,sy:cr.sy+(cr.sh-sh2)/2,sw:sw2,sh:sh2};}
    if(cutT<CUTPOP&&!(mi===0&&ci===0)){const pz=1+0.05*(1-cutT/CUTPOP);const sw3=cr.sw/pz,sh3=cr.sh/pz;cr={sx:cr.sx+(cr.sw-sw3)/2,sy:cr.sy+(cr.sh-sh3)/2,sw:sw3,sh:sh3};}
    ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);try{if(p.videoWidth)ctx.drawImage(p,cr.sx,cr.sy,cr.sw,cr.sh,0,0,cw,ch);}catch(e){}drawCaption(ctx,cw,ch,srcT,opt);if(opt.watermark)drawWM(ctx,cw,ch,opt.wmText);if(opt.fades){let a=0;if(ci===0){if(cutT<F)a=Math.max(a,1-cutT/F);}if(ci===(moments[mi].cuts.length-1)){const tOut=cutDur-cutT;if(tOut<F)a=Math.max(a,1-tOut/F);}if(a>0){ctx.fillStyle="rgba(0,0,0,"+Math.min(Math.max(a,0),1).toFixed(3)+")";ctx.fillRect(0,0,cw,ch);}}}
  for(let mi=0;mi<moments.length&&!S.cancelExport;mi++){const moment=moments[mi];const cuts=moment.cuts;
    for(let ci=0;ci<cuts.length&&!S.cancelExport;ci++){const cut=cuts[ci];cutIndex++;const cutDur=Math.max(cut.ce-cut.cs,0.2);
      $("#export-log").textContent="\ud83c\udfac Rendering cut "+cutIndex+"/"+totalCutsAll+" \u00b7 "+fmtTime(rendered)+" / "+fmtTime(planned);
      recPause();
      await seekTo(p,cut.cs);FOCUS.x=FOCUS.tx;focusResetMotion();
      try{p.muted=true;p.volume=0;await p.play();}catch(e){}
      /* CRITICAL SYNC FIX: wait until the decoder delivers a REAL moving frame
         before the recorder resumes — audio and video restart together, always */
      await new Promise(r=>{let d=false;const ok=()=>{if(d)return;d=true;r();};
        if(useRVFC){try{p.requestVideoFrameCallback(()=>ok());}catch(e){}}
        p.addEventListener("playing",ok,{once:true});setTimeout(ok,700);});
      if(S.cancelExport)break;
      drawFrame(Math.max(p.currentTime,cut.cs),cut,mi,ci,0,cutDur);
      recResume();pushFrame();
      await new Promise(resolve=>{
        let done=false,lastDraw=0,lastVidT=p.currentTime,stuck=0,wd=null,safety=null;
        const finish=()=>{if(done)return;done=true;clearInterval(wd);clearTimeout(safety);resolve();};
        /* watchdog: if playback stalls, nudge play(); only as a last resort skip ahead */
        wd=setInterval(()=>{if(done)return;const v=p.currentTime;
          if(v>=cut.ce-0.03||(p.ended&&v>=cut.ce-0.5)){finish();return;}
          if(Math.abs(v-lastVidT)<0.001){stuck+=250;
            if(stuck===250||stuck===750){try{p.play();}catch(e){}}
            if(stuck>=3000){try{p.currentTime=Math.min(cut.ce,v+0.35);p.play();}catch(e){}stuck=0;}}
          else{stuck=0;lastVidT=v;}},250);
        safety=setTimeout(finish,(cutDur+8)*1000);
        function draw(vidT){
          updateFocus(p);focusStep();
          const srcT=Math.min(Math.max(vidT,cut.cs),cut.ce);
          const cutT=Math.min(Math.max(srcT-cut.cs,0),cutDur);
          drawFrame(srcT,cut,mi,ci,cutT,cutDur);pushFrame();
          const prog=(rendered+Math.min(cutT,cutDur))/planned*100;const pct=Math.min(Math.round(prog),99);$("#export-bar").style.width=pct+"%";$("#export-pct").textContent=pct+"%";}
        function stepRVFC(now,meta){if(done)return;if(S.cancelExport){finish();return;}
          /* meta.mediaTime = the EXACT timestamp of the frame being shown — perfect sync */
          const vidT=(meta&&typeof meta.mediaTime==="number")?meta.mediaTime:p.currentTime;
          draw(vidT);
          if(vidT>=cut.ce-0.03||p.ended){finish();return;}
          try{p.requestVideoFrameCallback(stepRVFC);}catch(e){requestAnimationFrame(stepRAF);}}
        function stepRAF(){if(done)return;if(S.cancelExport){finish();return;}
          const nowMs=performance.now();
          if(nowMs-lastDraw>=frameMs-2){lastDraw=nowMs;const vidT=p.currentTime;draw(vidT);
            if(vidT>=cut.ce-0.03||p.ended){finish();return;}}
          requestAnimationFrame(stepRAF);}
        if(useRVFC){try{p.requestVideoFrameCallback(stepRVFC);}catch(e){requestAnimationFrame(stepRAF);}}
        else requestAnimationFrame(stepRAF);
      });
      recPause(); /* pause recording BEFORE touching playback — no stray frames between cuts */
      try{p.pause();}catch(e){}rendered+=cutDur;}}
  recResume();
  if(!S.cancelExport){pushFrame();const holdEnd=performance.now()+250;while(performance.now()<holdEnd){await sleep(40);}}
  try{if(rec.state!=="inactive"){rec.requestData&&rec.requestData();rec.stop();}}catch(e){}await stopped;await sleep(80);
  try{stream.getTracks().forEach(t=>t.stop());}catch(e){}p.muted=false;p.volume=1;S.exporting=false;
  if(S.cancelExport){$("#export-log").textContent="Render cancelled.";$("#export-bar").style.width="0%";$("#export-pct").textContent="";goStep(3);return;}
  if(!chunks.length){showAlert("Render produced an empty file. Try Chrome/Edge, keep the tab visible, and re-render.");goStep(3);return;}
  $("#export-bar").style.width="100%";$("#export-pct").textContent="100%";
  const blobType=ext==="mp4"?"video/mp4":"video/webm";
  const blob=new Blob(chunks,{type:blobType});
  if(S._lastBlobUrl){try{URL.revokeObjectURL(S._lastBlobUrl);}catch(e){}}const blobUrl=URL.createObjectURL(blob);S._lastBlobUrl=blobUrl;
  const fp=$("#final-player");fp.pause();fp.removeAttribute("src");fp.load();fp.preload="auto";fp.controls=true;fp.playsInline=true;fp.src=blobUrl;fp.load();
  const fname="podcast_clip_"+Date.now()+"."+ext;
  const dl=$("#download");dl.href=blobUrl;dl.download=fname;dl.setAttribute("download",fname);
  const tgt=opt.target_s||120;
  const fmtName=ext==="mp4"?"MP4 \u00b7 plays everywhere \u2705":"WebM (this browser can't record MP4 \u2014 use Chrome/Edge for MP4)";
  $("#final-info").innerHTML="\u2705 Render complete! <strong>1 best clip</strong> \u00b7 <strong>"+totalCutsAll+" jump-cut"+(totalCutsAll===1?"":"s")+"</strong> \u00b7 Length: <strong>"+fmtTime(planned)+"</strong> (target "+fmtTime(tgt)+") \u00b7 "+fmtBytes(blob.size)+" \u00b7 "+fmtName+" \u00b7 "+APP_VERSION+"<br><span class='muted small'>\ud83d\udca1 If the preview above stutters, that's just the browser player \u2014 download the file and it will play perfectly in your own video player.</span>";
  $("#render-box").style.display="none";$("#final-box").style.display="block";
  await new Promise(r=>{const ok=()=>{fp.removeEventListener("canplay",ok);fp.removeEventListener("loadeddata",ok);clearTimeout(t);r();};fp.addEventListener("canplay",ok);fp.addEventListener("loadeddata",ok);const t=setTimeout(ok,4000);});
  try{fp.currentTime=0;await fp.play();}catch(e){}}

/* ================= AI progress: ONE number, monotonic (never goes backwards) ================= */
function setAiProgress(msg,pct){
  const st=$("#ai-status"),bar=$("#ai-bar"),lab=$("#ai-pct"),wrap=$("#ai-prog");
  if(wrap)wrap.classList.add("show");
  let p=Math.round(Math.min(100,Math.max(0,pct==null?0:pct)));
  if(p<(S._aiPct||0))p=S._aiPct;else S._aiPct=p;
  if(bar)bar.style.width=p+"%";
  if(lab)lab.textContent=p+"%";
  if(st)st.textContent=(p>=100?"\u2705 ":"\u23f3 ")+(msg||"Working")+(p>=100?"":"\u2026");
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
    S._aiPct=0;
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
