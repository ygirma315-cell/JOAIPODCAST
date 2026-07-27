"use strict";

/* ================= STEP 4: GENERATE ================= */
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
  S.candidates=scored;S.selected=picked;S.dropped=new Set();S.added=new Set();
  if(!picked.length){showAlert("No clips found \u2014 the transcript may be too short. Try a shorter target duration.");goStep(3);return;}
  await sleep(400);showResults();}

/* ================= STEP 5: RESULTS ================= */
function showResults(){goStep(5);const p=$("#player");if(p.src!==S.videoURL)p.src=S.videoURL;renderSegList();renderCandList();renderTimeline();updateOverlay();}
function activeSegs(){const out=[];for(const seg of S.selected)if(!S.dropped.has(seg.id))out.push(seg);for(const id of S.added){const c=S.candidates.find(x=>x.id===id);if(c&&!out.includes(c))out.push(ensureBounds(c));}return out.sort((a,b)=>a.cs-b.cs);}
function previewSeg(seg){ensureBounds(seg);stopPreview(true);const p=$("#player");S.previewOne=seg;p.currentTime=seg.cs;p.play();$("#now-playing").textContent="\u25b6 Previewing clip "+fmtTime(seg.cs)+" \u2013 "+fmtTime(seg.ce);
  const onT=()=>{if(p.currentTime>=seg.ce){p.pause();p.removeEventListener("timeupdate",onT);S.previewOne=null;$("#now-playing").textContent="";}};p.addEventListener("timeupdate",onT);}
function renderTimeline(){const tl=$("#timeline");tl.innerHTML='<div class="playhead" id="playhead" style="opacity:0"></div>';
  const segs=activeSegs().map(ensureBounds);const totalEdit=segs.reduce((n,s)=>n+(s.ce-s.cs),0)||1;
  let cum=0;segs.forEach((seg,i)=>{const d=seg.ce-seg.cs;const el=document.createElement("div");el.className="clip";el.style.left=(cum/totalEdit*100)+"%";el.style.width="calc("+(d/totalEdit*100)+"% - 2px)";el.title="Clip "+(i+1)+": "+fmtTime(seg.cs)+" \u2013 "+fmtTime(seg.ce)+" (source)";el.innerHTML='<span class="n">'+(i+1)+'</span><span class="t">'+Math.round(d)+'s</span>';el.addEventListener("click",e=>{e.stopPropagation();previewSeg(seg);});tl.appendChild(el);cum+=d;});
  tl.onclick=e=>{const segs2=activeSegs().map(ensureBounds);const tot=segs2.reduce((n,s)=>n+(s.ce-s.cs),0)||1;const frac=Math.min(Math.max((e.clientX-tl.getBoundingClientRect().left)/tl.getBoundingClientRect().width,0),1);let target=frac*tot;for(const s of segs2){const d=s.ce-s.cs;if(target<=d){const p=$("#player");p.currentTime=s.cs+target;p.play();return;}target-=d;}};
  const cut=S.videoDuration||0;$("#tl-total").textContent=segs.length+" clips \u00b7 final edit "+fmtTime(totalEdit)+" (cut from "+fmtTime(cut)+")";}
function updatePlayhead(){const ph=$("#playhead");if(!ph)return;const p=$("#player");const segs=activeSegs().map(ensureBounds);const tot=segs.reduce((n,s)=>n+(s.ce-s.cs),0)||1;let cum=0,pos=null;for(const s of segs){if(p.currentTime>=s.cs&&p.currentTime<=s.ce){pos=(cum+(p.currentTime-s.cs))/tot;break;}cum+=s.ce-s.cs;}
  if(pos==null){ph.style.opacity="0";}else{ph.style.opacity="1";ph.style.left=(pos*100)+"%";}}
function stopPreview(silent){S.previewRun=null;S.previewOne=null;const p=$("#player");if(!silent){p.pause();$("#now-playing").textContent="";}}
async function previewAll(){const segs=activeSegs().map(ensureBounds);if(!segs.length){showAlert("No clips selected.");return;}stopPreview(true);const run={};S.previewRun=run;const p=$("#player");
  for(let i=0;i<segs.length;i++){if(S.previewRun!==run)return;const seg=segs[i];$("#now-playing").textContent="\u25b6 Full edit \u2014 clip "+(i+1)+" of "+segs.length;p.currentTime=seg.cs;try{await p.play();}catch(e){return;}
    await new Promise(res=>{const onT=()=>{if(S.previewRun!==run||p.currentTime>=seg.ce){p.removeEventListener("timeupdate",onT);res();}};p.addEventListener("timeupdate",onT);});
    if(S.previewRun!==run)return;}
  p.pause();$("#now-playing").textContent="";S.previewRun=null;}
function renderSegList(){const box=$("#segment-list");box.innerHTML="";const maxScore=arrMax(S.selected.map(s=>s.score).concat([0.0001]));
  S.selected.forEach((seg,i)=>{ensureBounds(seg);const card=document.createElement("div");card.className="seg-card"+(S.dropped.has(seg.id)?" dropped":"");card.style.animationDelay=(i*70)+"ms";
    const cb=document.createElement("input");cb.type="checkbox";cb.checked=!S.dropped.has(seg.id);cb.addEventListener("change",()=>{cb.checked?S.dropped.delete(seg.id):S.dropped.add(seg.id);card.classList.toggle("dropped",!cb.checked);renderTimeline();});
    const main=document.createElement("div");main.className="seg-main";
    const time=document.createElement("div");time.className="seg-time";time.textContent="Clip "+(i+1)+" \u00b7 "+fmtTime(seg.cs)+" \u2013 "+fmtTime(seg.ce)+" ("+Math.round(seg.ce-seg.cs)+"s)";
    const txt=document.createElement("div");txt.className="seg-text";txt.textContent=seg.text;
    const tags=document.createElement("div");tags.className="seg-tags";const sc=document.createElement("span");sc.className="tag score";sc.textContent="score "+seg.score.toFixed(2);tags.appendChild(sc);(seg.reasons||[]).forEach(r=>{const t=document.createElement("span");t.className="tag";t.textContent=r;tags.appendChild(t);});
    const meter=document.createElement("div");meter.className="meter";const fill=document.createElement("i");fill.style.width=Math.round(seg.score/maxScore*100)+"%";meter.appendChild(fill);
    main.appendChild(time);main.appendChild(txt);main.appendChild(tags);main.appendChild(meter);
    const acts=document.createElement("div");acts.className="seg-actions";const pv=document.createElement("button");pv.className="btn mini";pv.textContent="\u25b6 Play";pv.addEventListener("click",()=>previewSeg(seg));acts.appendChild(pv);
    card.appendChild(cb);card.appendChild(main);card.appendChild(acts);box.appendChild(card);});}
function renderCandList(){const box=$("#cand-list");box.innerHTML="";const selIds=new Set(S.selected.map(s=>s.id));const extras=S.candidates.filter(c=>!selIds.has(c.id)).slice(0,12);
  if(!extras.length){box.innerHTML='<p class="muted small">No other strong candidates.</p>';return;}
  extras.forEach(c=>{ensureBounds(c);const row=document.createElement("div");row.className="seg-card";row.style.alignItems="center";
    const ab=document.createElement("button");ab.className="btn mini";const upd=()=>{ab.textContent=S.added.has(c.id)?"\u2713 Added":"+ Add";};upd();ab.addEventListener("click",()=>{S.added.has(c.id)?S.added.delete(c.id):S.added.add(c.id);upd();renderTimeline();});
    const pv=document.createElement("button");pv.className="btn mini";pv.textContent="\u25b6";pv.addEventListener("click",()=>previewSeg(c));
    const info=document.createElement("div");info.className="seg-main";
    const b=document.createElement("b");b.textContent=fmtTime(c.start)+"\u2013"+fmtTime(c.end)+" (score "+c.score.toFixed(2)+")";
    const why=document.createElement("span");why.className="muted small";why.textContent=(c.reasons||[]).length?" \u00b7 "+(c.reasons||[]).join(", "):"";
    const txt=document.createElement("div");txt.className="seg-text";txt.textContent=c.text.slice(0,120)+(c.text.length>120?"\u2026":"");
    info.appendChild(b);info.appendChild(why);info.appendChild(txt);
    row.appendChild(ab);row.appendChild(pv);row.appendChild(info);box.appendChild(row);});}
function updatePlan(){renderTimeline();$("#now-playing").textContent="";showAlert("");const n=activeSegs().length;if(!n)showAlert("All clips are unchecked \u2014 select at least one.");}

/* ================= CAPTIONS ================= */
const CAP_MAX_WORDS=6;
function wordSpans(sent){if(sent._words)return sent._words;const words=sent.text.split(/\s+/).filter(Boolean);const dur=Math.max(sent.end-sent.start,0.3);const per=dur/words.length;sent._words=words.map((w,i)=>({w,t0:sent.start+i*per,t1:sent.start+(i+1)*per}));return sent._words;}
function capChunk(sent,t){const ws=wordSpans(sent);let idx=ws.findIndex(x=>t>=x.t0&&t<x.t1);if(idx<0)idx=t>=sent.end?ws.length-1:0;const c0=Math.floor(idx/CAP_MAX_WORDS)*CAP_MAX_WORDS;return{words:ws.slice(c0,c0+CAP_MAX_WORDS),active:idx-c0};}
function updateOverlay(){const ov=$("#cap-overlay");const p=$("#player");if(!S.opts.captions){ov.style.opacity="0";return;}
  const t=p.currentTime;const sent=S.sentences.find(s=>t>=s.start&&t<=s.end);
  if(!sent){ov.style.opacity="0";return;}
  const{words,active}=capChunk(sent,t);
  ov.innerHTML=words.map((x,i)=>'<span class="w'+(i===active?" on":"")+'">'+esc(x.w)+"</span>").join(" ");
  ov.style.color=S.opts.style==="clean"?"#FFFFFF":S.opts.colorText;ov.style.setProperty("--capHl",S.opts.colorHl);
  ov.style.fontFamily=S.opts.style==="mono"?"Menlo,Consolas,monospace":"inherit";
  ov.style.textTransform=S.opts.style==="bold"?"uppercase":"none";
  ov.style.opacity="1";}

/* ================= EXPORT ================= */
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
async function exportClips(){if(S.exporting)return;const segs=activeSegs().map(ensureBounds);if(!segs.length){showAlert("No clips selected \u2014 check at least one.");return;}
  const opt={...S.opts};S.exporting=true;S.cancelExport=false;stopPreview(false);
  const box=$("#export-box");box.style.display="block";$("#export-bar").style.width="0%";$("#download").style.display="none";$("#export-log").textContent="Preparing renderer\u2026";
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
    $("#export-log").textContent="Rendering clip "+(i+1)+" of "+segs.length+"\u2026";
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
  if(S.cancelExport){$("#export-log").textContent="Export cancelled.";$("#export-bar").style.width="0%";return;}
  const blob=new Blob(chunks,{type:"video/webm"});const url=URL.createObjectURL(blob);
  const dl=$("#download");dl.href=url;dl.download="viralshort_"+Date.now()+".webm";dl.style.display="inline-flex";
  $("#export-bar").style.width="100%";
  $("#export-log").textContent="\u2713 Done! "+fmtBytes(blob.size)+" \u00b7 WebM format (use CloudConvert for MP4).";}

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
  $("#update-plan").addEventListener("click",updatePlan);
  $("#render-final").addEventListener("click",exportClips);
  $("#cancel-export").addEventListener("click",()=>{S.cancelExport=true;});
  $("#start-over").addEventListener("click",()=>location.reload());
  $("#preview-all").addEventListener("click",previewAll);
  $("#stop-preview").addEventListener("click",()=>stopPreview(false));
  $("#colors-reset").addEventListener("click",()=>{$("#opt-color-text").value="#FFFF00";$("#opt-color-hl").value="#FFFFFF";S.opts.colorText="#FFFF00";S.opts.colorHl="#FFFFFF";});
  $("#opt-color-text").addEventListener("input",e=>S.opts.colorText=e.target.value);
  $("#opt-color-hl").addEventListener("input",e=>S.opts.colorHl=e.target.value);
  $("#opt-captions").addEventListener("change",e=>S.opts.captions=e.target.checked);
  $("#opt-fades").addEventListener("change",e=>S.opts.fades=e.target.checked);
  $("#opt-watermark").addEventListener("change",e=>{S.opts.watermark=e.target.checked;$("#wm-group").style.display=e.target.checked?"block":"none";});
  $("#opt-wm-text").addEventListener("input",e=>S.opts.wmText=e.target.value);
  const p=$("#player");["timeupdate","play","pause","seeked"].forEach(ev=>p.addEventListener(ev,()=>{updateOverlay();updatePlayhead();}));
}
boot();
