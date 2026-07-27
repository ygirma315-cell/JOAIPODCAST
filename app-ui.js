"use strict";

/* ================= STEP 4: ANALYZE ================= */
const STAGES=[["probe","Reading video & transcript"],["audio","Analyzing audio energy"],["cands","Building candidate moments"],["score","Scoring 18 virality signals"],["select","Picking the best distinct clips"],["refine","Refining clip boundaries"]];
function initStages(){const ul=$("#stages");ul.innerHTML="";for(const[id,label]of STAGES){const li=document.createElement("li");li.id="st-"+id;li.innerHTML='<span class="st-ic">\u25cb</span><span></span>';li.querySelector("span:last-child").textContent=label;ul.appendChild(li);}}
function setStage(id,state){const li=$("#st-"+id);if(!li)return;li.classList.remove("st-active","st-done");if(state==="active")li.classList.add("st-active");if(state==="done"){li.classList.add("st-done");li.querySelector(".st-ic").textContent="\u2713";}}
async function generate(){goStep(4);initStages();const bar=$("#job-bar");bar.style.width="4%";$("#progress-title").textContent="Finding your viral moments\u2026";
  setStage("probe","active");await sleep(250);setStage("probe","done");bar.style.width="14%";
  setStage("audio","active");if(!S.audioEnergy&&S.videoFile)S.audioEnergy=await analyzeAudio(S.videoFile);
  if(S.audioEnergy&&S.audioEnergy.length){const m=S.audioEnergy.reduce((a,b)=>a+b,0)/S.audioEnergy.length;const varr=S.audioEnergy.reduce((a,b)=>a+(b-m)*(b-m),0)/S.audioEnergy.length;S.audioStats={mean:m,std:Math.sqrt(varr)||0.001};}
  setStage("audio","done");bar.style.width="38%";
  setStage("cands","active");await sleep(120);const corpus=buildCorpus(S.sentences);const cands=buildCandidates(S.sentences,S.opts.target_s);setStage("cands","done");bar.style.width="56%";
  setStage("score","active");await sleep(120);const scored=scoreAll(cands,corpus,S.videoDuration||(S.sentences.length?S.sentences[S.sentences.length-1].end:600),S.audioEnergy,S.opts.target_s,S.audioStats);setStage("score","done");bar.style.width="74%";
  setStage("select","active");await sleep(120);const picked=selectTop(scored,S.opts.count);setStage("select","done");bar.style.width="88%";
  setStage("refine","active");picked.forEach(ensureBounds);setStage("refine","done");bar.style.width="100%";
  S.candidates=scored;S.selected=picked;
  if(!picked.length){showAlert("No clips found \u2014 the transcript may be too short. Try a shorter target duration.");goStep(3);return;}
  await sleep(400);startRender();}

/* ================= STEP 5: RENDER + FINAL VIDEO ================= */
async function startRender(){goStep(5);
  $("#render-box").style.display="block";$("#final-box").style.display="none";
  const p=$("#player");
  if(p.src!==S.videoURL){p.src=S.videoURL;
    await new Promise(r=>{if(p.readyState>=1)r();else p.addEventListener("loadedmetadata",()=>r(),{once:true});});}
  const segs=S.selected.map(ensureBounds).sort((a,b)=>a.cs-b.cs);
  const tot=segs.reduce((n,s)=>n+(s.ce-s.cs),0);
  $("#render-info").textContent=segs.length+" best moments picked \u00b7 final video \u2248 "+fmtTime(tot);
  exportClips();}

/* ================= CAPTIONS (burned into render) ================= */
const CAP_MAX_WORDS=6;
function wordSpans(sent){if(sent._words)return sent._words;const words=sent.text.split(/\s+/).filter(Boolean);const dur=Math.max(sent.end-sent.start,0.3);const per=dur/words.length;sent._words=words.map((w,i)=>({w,t0:sent.start+i*per,t1:sent.start+(i+1)*per}));return sent._words;}
function capChunk(sent,t){const ws=wordSpans(sent);let idx=ws.findIndex(x=>t>=x.t0&&t<x.t1);if(idx<0)idx=t>=sent.end?ws.length-1:0;const c0=Math.floor(idx/CAP_MAX_WORDS)*CAP_MAX_WORDS;return{words:ws.slice(c0,c0+CAP_MAX_WORDS),active:idx-c0};}
function cropRect(vw,vh,cw,ch){const sc=Math.max(cw/vw,ch/vh);const sw=cw/sc,sh=ch/sc;return{sx:(vw-sw)/2,sy:(vh-sh)/2,sw,sh};}
function layoutWords(ctx,words,maxW){const lines=[];let line=[];for(const w of words){const test=line.concat([w]).map(x=>x.w).join(" ");if(ctx.measureText(test).width>maxW&&line.length){lines.push(line);line=[w];}else line.push(w);}if(line.length)lines.push(line);return lines.slice(0,2);}
function drawCaption(ctx,cw,ch,t,opt){if(!opt.captions)return;const sent=S.sentences.find(s=>t>=s.start&&t<=s.end);if(!sent)return;const{words,active}=capChunk(sent,t);
  const fs=Math.round(cw*0.055);ctx.font="900 "+fs+"px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";if(opt.style==="mono")ctx.font="900 "+Math.round(fs*0.9)+"px Menlo,Consolas,monospace";
  ctx.textAlign="center";ctx.textBaseline="middle";
  const lines=layoutWords(ctx,words,cw*0.86);const lh=fs*1.3;const baseY=ch*0.86-(lines.length-1)*lh;
  let wi=0;
  lines.forEach((line,li)=>{const texts=line.map(x=>opt.style==="bold"?x.w.toUpperCase():x.w);const widths=texts.map(s=>ctx.measureText(s).width);const gap=fs*0.32;const totW=widths.reduce((a,b)=>a+b,0)+gap*(texts.length-1);
    let x=cw/2-totW/2;const y=baseY+li*lh;
    texts.forEach((s,i)=>{const isOn=wi===active;ctx.save();ctx.shadowColor="rgba(0,0,0,.9)";ctx.shadowBlur=fs*0.35;ctx.lineWidth=Math.max(fs*0.12,3);ctx.strokeStyle="rgba(0,0,0,.85)";
      const cx=x+widths[i]/2;
      if(isOn){ctx.translate(cx,y);ctx.scale(1.1,1.1);ctx.translate(-cx,-y);}
      ctx.strokeText(s,cx,y);ctx.fillStyle=isOn?opt.colorHl:(opt.style==="clean"?"#FFFFFF":opt.colorText);ctx.fillText(s,cx,y);ctx.restore();
      x+=widths[i]+gap;wi++;});});}
function drawWM(ctx,cw,ch,text){if(!text)return;ctx.save();const fs=Math.round(cw*0.03);ctx.font="700 "+fs+"px -apple-system,sans-serif";ctx.textAlign="right";ctx.textBaseline="top";ctx.shadowColor="rgba(0,0,0,.7)";ctx.shadowBlur=6;ctx.fillStyle="rgba(255,255,255,.82)";ctx.fillText(text,cw-fs,fs);ctx.restore();}

/* ================= RENDER ENGINE ================= */
async function exportClips(){if(S.exporting)return;
  const segs=S.selected.map(ensureBounds).sort((a,b)=>a.cs-b.cs);
  if(!segs.length){showAlert("Nothing to render \u2014 run the analysis first.");goStep(3);return;}
  const opt={...S.opts};S.exporting=true;S.cancelExport=false;
  $("#export-bar").style.width="0%";$("#export-log").textContent="Preparing renderer\u2026";
  const p=$("#player");p.muted=false;
  let cw=1080,ch=1920;if(opt.aspect==="1:1"){cw=1080;ch=1080;}if(opt.aspect==="16:9"){cw=1280;ch=720;}
  const canvas=document.createElement("canvas");canvas.width=cw;canvas.height=ch;const ctx=canvas.getContext("2d");
  const stream=canvas.captureStream(30);
  try{const ps=p.captureStream?p.captureStream():p.mozCaptureStream?p.mozCaptureStream():null;if(ps)ps.getAudioTracks().forEach(t=>stream.addTrack(t));}catch(e){console.warn("No audio track:",e);}
  let mime="video/webm;codecs=vp9,opus";if(!MediaRecorder.isTypeSupported(mime))mime="video/webm;codecs=vp8,opus";if(!MediaRecorder.isTypeSupported(mime))mime="video/webm";
  const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8_000_000});
  const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const done=new Promise(res=>{rec.onstop=res;});
  rec.start(250);
  const total=segs.reduce((n,s)=>n+(s.ce-s.cs),0)||1;let rendered=0;const F=0.4;
  for(let i=0;i<segs.length&&!S.cancelExport;i++){const seg=segs[i];
    $("#export-log").textContent="\ud83c\udfac Rendering clip "+(i+1)+" of "+segs.length+"\u2026";
    p.currentTime=seg.cs;
    await new Promise(res=>{const on=()=>{p.removeEventListener("seeked",on);res();};p.addEventListener("seeked",on);});
    try{await p.play();}catch(e){}
    await new Promise(resolve=>{function frame(){if(S.cancelExport){resolve();return;}
      const vw=p.videoWidth||cw,vh=p.videoHeight||ch;const cr=cropRect(vw,vh,cw,ch);
      ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);
      if(p.videoWidth)ctx.drawImage(p,cr.sx,cr.sy,cr.sw,cr.sh,0,0,cw,ch);
      drawCaption(ctx,cw,ch,p.currentTime,opt);
      if(opt.watermark)drawWM(ctx,cw,ch,opt.wmText);
      if(opt.fades){const tIn=p.currentTime-seg.cs,tOut=seg.ce-p.currentTime;let a=0;if(tIn<F)a=1-tIn/F;else if(tOut<F)a=1-tOut/F;if(a>0){ctx.fillStyle="rgba(0,0,0,"+Math.min(Math.max(a,0),1).toFixed(3)+")";ctx.fillRect(0,0,cw,ch);}}
      const prog=(rendered+Math.max(p.currentTime-seg.cs,0))/total*100;$("#export-bar").style.width=Math.min(prog,100)+"%";
      if(p.currentTime>=seg.ce||p.ended){resolve();return;}
      requestAnimationFrame(frame);}
      frame();});
    p.pause();rendered+=seg.ce-seg.cs;}
  rec.stop();await done;
  S.exporting=false;
  if(S.cancelExport){$("#export-log").textContent="Render cancelled.";$("#export-bar").style.width="0%";goStep(3);return;}
  const blob=new Blob(chunks,{type:"video/webm"});const url=URL.createObjectURL(blob);
  const fp=$("#final-player");fp.src=url;
  const dl=$("#download");dl.href=url;dl.download="podcast_clip_"+Date.now()+".webm";
  $("#final-info").textContent="\u2713 Done! "+segs.length+" moments \u00b7 "+fmtTime(total)+" \u00b7 "+fmtBytes(blob.size)+" \u00b7 WebM (use CloudConvert for MP4)";
  $("#render-box").style.display="none";$("#final-box").style.display="block";
  try{fp.play();}catch(e){}}

/* ================= BOOT ================= */
function boot(){
  initGate();initOpts();goStep(1);
  bindDrop("#video-drop","#video-input",handleVideo);
  bindDrop("#tr-drop","#tr-input",f=>{const rd=new FileReader();rd.onload=()=>handleTranscript(f.name,String(rd.result||""));rd.readAsText(f);});
  let deb;$("#tr-text").addEventListener("input",()=>{clearTimeout(deb);deb=setTimeout(()=>{const t=$("#tr-text").value.trim();if(t.length>10)handleTranscript(null,t);},700);});
  /* Transcript source selector: Transcript 1 (API) / Transcript 2 (website) */
  $$("#yt-source button").forEach(b=>b.addEventListener("click",()=>{
    ytSource=Number(b.dataset.src)||1;
    $$("#yt-source button").forEach(x=>x.classList.remove("sel"));
    b.classList.add("sel");
    ytReady=false;
    $("#yt-status").textContent="Source set to Transcript "+ytSource+" \u2014 press \u26a1 Fetch transcript.";}));
  $("#yt-fetch").addEventListener("click",()=>{fetchYouTube();});
  $("#yt-url").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();fetchYouTube();}});
  $("#use-yt").addEventListener("click",async()=>{
    if(ytReady&&S.sentences.length){goStep(3);return;}
    if(!$("#yt-url").value.trim()){$("#yt-status").textContent="\u26a0 It's empty \u2014 paste a YouTube link first (or use the Manual side).";return;}
    const ok=await fetchYouTube();
    if(ok&&S.sentences.length)goStep(3);});
  $("#use-manual").addEventListener("click",()=>{
    const t=$("#tr-text").value.trim();
    if(t.length>10)handleTranscript(null,t);
    if(S.sentences.length&&(manualReady||t.length>10)){goStep(3);return;}
    showAlert("Manual side is empty \u2014 paste a transcript or upload a file first.");});
  $("#to-step-2").addEventListener("click",()=>goStep(2));
  $$("[data-back]").forEach(b=>b.addEventListener("click",()=>goStep(Number(b.dataset.back))));
  $("#generate").addEventListener("click",()=>{
    if(!S.videoFile){showAlert("Load a video first (step 1).");goStep(1);return;}
    if(!S.sentences.length){showAlert("Add a transcript first (step 2).");goStep(2);return;}
    generate();});
  $("#cancel-export").addEventListener("click",()=>{S.cancelExport=true;});
  $("#render-again").addEventListener("click",()=>{if(!S.exporting)startRender();});
  $("#start-over").addEventListener("click",()=>location.reload());
  $("#colors-reset").addEventListener("click",()=>{$("#opt-color-text").value="#FFFF00";$("#opt-color-hl").value="#FFFFFF";S.opts.colorText="#FFFF00";S.opts.colorHl="#FFFFFF";});
  $("#opt-color-text").addEventListener("input",e=>S.opts.colorText=e.target.value);
  $("#opt-color-hl").addEventListener("input",e=>S.opts.colorHl=e.target.value);
  $("#opt-captions").addEventListener("change",e=>S.opts.captions=e.target.checked);
  $("#opt-fades").addEventListener("change",e=>S.opts.fades=e.target.checked);
  $("#opt-watermark").addEventListener("change",e=>{S.opts.watermark=e.target.checked;$("#wm-group").style.display=e.target.checked?"block":"none";});
  $("#opt-wm-text").addEventListener("input",e=>S.opts.wmText=e.target.value);
}
boot();
