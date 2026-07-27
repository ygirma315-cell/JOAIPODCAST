"use strict";

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
  let picked;
  if(typeof pickBestSingleClip==="function"){picked=pickBestSingleClip(scored,S.sentences,sentScore,target);}
  else{picked=selectTop(scored,1);buildMomentCuts(picked,S.sentences,sentScore,target);picked=picked.filter(p=>p.cuts&&p.cuts.length);}
  setStage("select","done");setBar(88,"Best part locked");
  setStage("refine","active");setBar(90,"Keeping length between "+fmtTime(win.minS)+" \u2013 "+fmtTime(win.maxS));
  setStage("refine","done");setBar(100,"Done! Starting render");
  S.candidates=scored;S.selected=picked.filter(p=>p.cuts&&p.cuts.length);
  if(!S.selected.length){showAlert("No strong clip found near that length. Try another duration or a longer transcript.");goStep(3);return;}
  await sleep(350);startRender();}

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

/* ================= CAPTIONS ================= */
const CAP_MAX_WORDS=6;
function capStyle(opt){switch(opt.capTemplate){case "clean":return{upper:false,mono:false,text:"#FFFFFF",hl:opt.colorHl==="#FFFFFF"?"#FFD84D":opt.colorHl,glow:"rgba(0,0,0,.9)",box:false};case "mono":return{upper:false,mono:true,text:"#E8E8E8",hl:"#7CF5B8",glow:"rgba(0,0,0,.9)",box:false};case "neon":return{upper:true,mono:false,text:"#7DF9FF",hl:"#FF3CAC",glow:"rgba(0,229,255,.85)",box:false};case "boxed":return{upper:true,mono:false,text:"#FFFFFF",hl:"#FFE400",glow:null,box:true};default:return{upper:true,mono:false,text:opt.colorText||"#FFFF00",hl:opt.colorHl||"#FFFFFF",glow:"rgba(0,0,0,.9)",box:false};}}
function wordSpans(sent){if(sent._words)return sent._words;const words=sent.text.split(/\s+/).filter(Boolean);const dur=Math.max(sent.end-sent.start,0.3);const per=dur/words.length;sent._words=words.map((w,i)=>({w,t0:sent.start+i*per,t1:sent.start+(i+1)*per}));return sent._words;}
function capChunk(sent,t){const ws=wordSpans(sent);let idx=ws.findIndex(x=>t>=x.t0&&t<x.t1);if(idx<0)idx=t>=sent.end?ws.length-1:0;const c0=Math.floor(idx/CAP_MAX_WORDS)*CAP_MAX_WORDS;return{words:ws.slice(c0,c0+CAP_MAX_WORDS),active:idx-c0};}
function cropRect(vw,vh,cw,ch){const sc=Math.max(cw/vw,ch/vh);const sw=cw/sc,sh=ch/sc;return{sx:(vw-sw)/2,sy:(vh-sh)/2,sw,sh};}
function layoutWords(ctx,words,maxW){const lines=[];let line=[];for(const w of words){const test=line.concat([w]).map(x=>x.w).join(" ");if(ctx.measureText(test).width>maxW&&line.length){lines.push(line);line=[w];}else line.push(w);}if(line.length)lines.push(line);return lines.slice(0,2);}
function drawCaption(ctx,cw,ch,t,opt){if(!opt.captions||opt.capTemplate==="none")return;const sent=S.sentences.find(s=>t>=s.start&&t<=s.end);if(!sent)return;const{words,active}=capChunk(sent,t);const st=capStyle(opt);const sizeMap={s:0.042,m:0.055,l:0.07};const fs=Math.round(cw*(sizeMap[opt.capSize]||0.055));ctx.font="900 "+(st.mono?Math.round(fs*0.9)+"px Menlo,Consolas,monospace":fs+"px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif");ctx.textAlign="center";ctx.textBaseline="middle";const lines=layoutWords(ctx,words,cw*0.86);const lh=fs*1.35;const posMap={bottom:0.86,middle:0.55,top:0.16};const anchor=ch*(posMap[opt.capPos]||0.86);const baseY=anchor-(lines.length-1)*lh;let wi=0;lines.forEach((line,li)=>{const texts=line.map(x=>st.upper?x.w.toUpperCase():x.w);const widths=texts.map(s2=>ctx.measureText(s2).width);const gap=fs*0.32;const totW=widths.reduce((a,b)=>a+b,0)+gap*(texts.length-1);let x=cw/2-totW/2;const y=baseY+li*lh;if(st.box){ctx.save();ctx.fillStyle="rgba(0,0,0,.78)";ctx.fillRect(cw/2-totW/2-fs*0.45,y-lh*0.52,totW+fs*0.9,lh*1.04);ctx.restore();}texts.forEach((s2,i)=>{const isOn=wi===active;ctx.save();if(st.glow){ctx.shadowColor=st.glow;ctx.shadowBlur=fs*0.35;ctx.lineWidth=Math.max(fs*0.12,3);ctx.strokeStyle="rgba(0,0,0,.85)";}const cx=x+widths[i]/2;if(isOn){ctx.translate(cx,y);ctx.scale(1.12,1.12);ctx.translate(-cx,-y);}if(st.glow)ctx.strokeText(s2,cx,y);ctx.fillStyle=isOn?st.hl:st.text;ctx.fillText(s2,cx,y);ctx.restore();x+=widths[i]+gap;wi++;});});}
function drawWM(ctx,cw,ch,text){if(!text)return;ctx.save();const fs=Math.round(cw*0.03);ctx.font="700 "+fs+"px -apple-system,sans-serif";ctx.textAlign="right";ctx.textBaseline="top";ctx.shadowColor="rgba(0,0,0,.7)";ctx.shadowBlur=6;ctx.fillStyle="rgba(255,255,255,.82)";ctx.fillText(text,cw-fs,fs);ctx.restore();}

/* ================= ROBUST RENDER ENGINE ================= */
async function exportClips(){if(S.exporting)return;
  const moments=(S.selected||[]).filter(m=>m.cuts&&m.cuts.length);
  if(!moments.length){showAlert("Nothing to render \u2014 run the analysis first.");goStep(3);return;}
  const opt={...S.opts,count:1};S.exporting=true;S.cancelExport=false;
  $("#export-bar").style.width="0%";$("#export-pct").textContent="0%";
  $("#export-log").textContent="Preparing renderer\u2026";
  const p=$("#player");p.muted=true;p.volume=0;p.playbackRate=1;p.playsInline=true;
  if(!p.src||p.src!==S.videoURL){p.src=S.videoURL;p.load();}await waitMeta(p);
  let cw=1080,ch=1920;if(opt.aspect==="1:1"){cw=1080;ch=1080;}if(opt.aspect==="16:9"){cw=1280;ch=720;}
  const canvas=document.createElement("canvas");canvas.width=cw;canvas.height=ch;const ctx=canvas.getContext("2d",{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  const fps=30;const stream=canvas.captureStream(fps);
  try{const ps=p.captureStream?p.captureStream():(p.mozCaptureStream?p.mozCaptureStream():null);if(ps){ps.getAudioTracks().forEach(t=>{try{stream.addTrack(t);}catch(e){}});} }catch(e){console.warn("No audio track:",e);}
  let mime="video/webm;codecs=vp9,opus";if(!window.MediaRecorder||!MediaRecorder.isTypeSupported(mime))mime="video/webm;codecs=vp8,opus";if(!MediaRecorder.isTypeSupported(mime))mime="video/webm;codecs=vp8";if(!MediaRecorder.isTypeSupported(mime))mime="video/webm";
  let rec;try{rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6_000_000});}catch(e){try{rec=new MediaRecorder(stream,{mimeType:"video/webm",videoBitsPerSecond:4_000_000});mime="video/webm";}catch(e2){showAlert("This browser cannot record video (MediaRecorder missing). Try Chrome/Edge on desktop.");S.exporting=false;return;}}
  const chunks=[];rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};const stopped=new Promise(res=>{rec.onstop=()=>res();rec.onerror=()=>res();});
  ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);if(rec.state==="inactive")rec.start(200);await sleep(120);
  const planned=moments.reduce((n,m)=>n+(m.cutDuration||0),0)||1;let rendered=0;const F=0.35,CUTPOP=0.12;
  const totalCutsAll=moments.reduce((n,m)=>n+m.cuts.length,0);let cutIndex=0;
  function drawFrame(srcT,cut,mi,ci,cutT,cutDur){const vw=p.videoWidth||cw,vh=p.videoHeight||ch;let cr=cropRect(vw,vh,cw,ch);if(opt.zoom){const zp=Math.min(Math.max(cutT/Math.max(cutDur,0.01),0),1);const z=1+0.06*zp;const sw2=cr.sw/z,sh2=cr.sh/z;cr={sx:cr.sx+(cr.sw-sw2)/2,sy:cr.sy+(cr.sh-sh2)/2,sw:sw2,sh:sh2};}if(cutT<CUTPOP&&!(mi===0&&ci===0)){const pz=1+0.05*(1-cutT/CUTPOP);const sw3=cr.sw/pz,sh3=cr.sh/pz;cr={sx:cr.sx+(cr.sw-sw3)/2,sy:cr.sy+(cr.sh-sh3)/2,sw:sw3,sh:sh3};}ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);try{if(p.videoWidth)ctx.drawImage(p,cr.sx,cr.sy,cr.sw,cr.sh,0,0,cw,ch);}catch(e){}drawCaption(ctx,cw,ch,srcT,opt);if(opt.watermark)drawWM(ctx,cw,ch,opt.wmText);if(opt.fades){let a=0;if(ci===0){if(cutT<F)a=Math.max(a,1-cutT/F);}if(ci===(moments[mi].cuts.length-1)){const tOut=cutDur-cutT;if(tOut<F)a=Math.max(a,1-tOut/F);}if(a>0){ctx.fillStyle="rgba(0,0,0,"+Math.min(Math.max(a,0),1).toFixed(3)+")";ctx.fillRect(0,0,cw,ch);}}}
  for(let mi=0;mi<moments.length&&!S.cancelExport;mi++){const moment=moments[mi];const cuts=moment.cuts;
    for(let ci=0;ci<cuts.length&&!S.cancelExport;ci++){const cut=cuts[ci];cutIndex++;const cutDur=Math.max(cut.ce-cut.cs,0.2);
      $("#export-log").textContent="\ud83c\udfac Rendering cut "+cutIndex+"/"+totalCutsAll+" \u00b7 "+fmtTime(rendered)+" / "+fmtTime(planned);
      await seekTo(p,cut.cs);try{p.muted=true;p.volume=0;await p.play();}catch(e){}
      const t0=performance.now();let lastVidT=p.currentTime;let stuckMs=0;
      await new Promise(resolve=>{function tick(){if(S.cancelExport){resolve();return;}const wall=(performance.now()-t0)/1000;let vidT=p.currentTime;if(Math.abs(vidT-lastVidT)<0.001){stuckMs+=1000/fps;}else{stuckMs=0;lastVidT=vidT;}if(stuckMs>900){try{p.currentTime=Math.min(cut.ce,cut.cs+wall);}catch(e){}vidT=p.currentTime;stuckMs=0;}const srcT=Math.min(Math.max(vidT,cut.cs),cut.ce);const cutT=Math.min(Math.max(srcT-cut.cs,wall),cutDur);drawFrame(srcT,cut,mi,ci,cutT,cutDur);const prog=(rendered+Math.min(cutT,cutDur))/planned*100;const pct=Math.min(Math.round(prog),99);$("#export-bar").style.width=pct+"%";$("#export-pct").textContent=pct+"%";const doneByVid=vidT>=cut.ce-0.04;const doneByWall=wall>=cutDur;const ended=p.ended&&vidT>=cut.ce-0.5;if(doneByVid||doneByWall||ended){resolve();return;}requestAnimationFrame(tick);}requestAnimationFrame(tick);});
      try{p.pause();}catch(e){}rendered+=cutDur;}}
  if(!S.cancelExport){const holdEnd=performance.now()+250;while(performance.now()<holdEnd){await sleep(40);}}
  try{if(rec.state==="recording"){rec.requestData&&rec.requestData();rec.stop();}}catch(e){}await stopped;await sleep(80);
  try{stream.getTracks().forEach(t=>t.stop());}catch(e){}p.muted=false;p.volume=1;S.exporting=false;
  if(S.cancelExport){$("#export-log").textContent="Render cancelled.";$("#export-bar").style.width="0%";$("#export-pct").textContent="";goStep(3);return;}
  if(!chunks.length){showAlert("Render produced an empty file. Try Chrome/Edge, keep the tab visible, and re-render.");goStep(3);return;}
  $("#export-bar").style.width="100%";$("#export-pct").textContent="100%";
  const blob=new Blob(chunks,{type:mime.startsWith("video/")?mime.split(";")[0]:"video/webm"});
  if(S._lastBlobUrl){try{URL.revokeObjectURL(S._lastBlobUrl);}catch(e){}}const blobUrl=URL.createObjectURL(blob);S._lastBlobUrl=blobUrl;
  const fp=$("#final-player");fp.pause();fp.removeAttribute("src");fp.load();fp.preload="auto";fp.controls=true;fp.playsInline=true;fp.src=blobUrl;fp.load();
  const dl=$("#download");dl.href=blobUrl;dl.download="podcast_clip_"+Date.now()+".webm";dl.setAttribute("download","podcast_clip_"+Date.now()+".webm");
  const tgt=opt.target_s||120;
  $("#final-info").innerHTML="\u2705 Render complete! <strong>1 best clip</strong> \u00b7 <strong>"+totalCutsAll+" jump-cut"+(totalCutsAll===1?"":"s")+"</strong> \u00b7 Length: <strong>"+fmtTime(planned)+"</strong> (target "+fmtTime(tgt)+") \u00b7 "+fmtBytes(blob.size)+" \u00b7 WebM";
  $("#render-box").style.display="none";$("#final-box").style.display="block";
  await new Promise(r=>{const ok=()=>{fp.removeEventListener("canplay",ok);fp.removeEventListener("loadeddata",ok);clearTimeout(t);r();};fp.addEventListener("canplay",ok);fp.addEventListener("loadeddata",ok);const t=setTimeout(ok,4000);});
  try{fp.currentTime=0;await fp.play();}catch(e){}}

/* ================= AI progress UI helper ================= */
function setAiProgress(msg,pct){
  const st=$("#ai-status"),bar=$("#ai-bar"),lab=$("#ai-pct"),wrap=$("#ai-prog");
  if(wrap)wrap.classList.add("show");
  const p=Math.round(Math.min(100,Math.max(0,pct==null?0:pct)));
  if(bar)bar.style.width=p+"%";
  if(lab)lab.textContent=p+"%";
  if(st){
    let line=msg||"Working\u2026";
    if(p>=100)line="\u2713 "+line;
    else if(p>=90)line="\u23f3 "+line+" \u2014 almost there!";
    else if(p>=70)line="\u23f3 "+line;
    else line="\u23f3 "+line;
    st.textContent=line+" ("+p+"%)";
  }
}

/* ================= BOOT ================= */
function boot(){
  initGate();initOpts();goStep(1);S.opts.count=1;
  bindDrop("#video-drop","#video-input",handleVideo);
  bindDrop("#tr-drop","#tr-input",f=>{const rd=new FileReader();rd.onload=()=>handleTranscript(f.name,String(rd.result||""));rd.readAsText(f);});
  let deb;const trText=$("#tr-text");
  if(trText)trText.addEventListener("input",()=>{clearTimeout(deb);deb=setTimeout(()=>{const t=trText.value.trim();if(t.length>10)handleTranscript(null,t);},700);});

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
    setAiProgress("Starting\u2026",2);
    try{
      const sents=await transcribeWithDeepgram(S.videoFile,(msg,pct)=>setAiProgress(msg,pct));
      if(!sents.length){setAiProgress("No speech detected \u2014 try Manual instead",100);btn.disabled=false;return;}
      S.sentences=sents;aiReady=true;manualReady=false;
      const wc=sents.reduce((n,s)=>n+s.text.split(/\s+/).filter(Boolean).length,0);
      infoGrid("#tr-info",[["Source","AI Speech-to-Text"],["Words",String(wc)],["Lines",String(sents.length)],["Cover",fmtTime(sents[0].start)+" \u2013 "+fmtTime(sents[sents.length-1].end)]]);
      setAiProgress("Transcribed successfully",100);
      if(useBtn)useBtn.style.display="block";
    }catch(e){
      console.warn(e);
      setAiProgress("AI failed ("+(e&&e.message?e.message:"error")+") \u2014 use Manual",0);
      const st=$("#ai-status");if(st)st.textContent="\u26a0 AI failed ("+(e&&e.message?e.message:"error")+") \u2014 use Manual instead.";
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
  $("#start-over").addEventListener("click",()=>location.reload());
  $("#colors-reset").addEventListener("click",()=>{$("#opt-color-text").value="#FFFF00";$("#opt-color-hl").value="#FFFFFF";S.opts.colorText="#FFFF00";S.opts.colorHl="#FFFFFF";});
  $("#opt-color-text").addEventListener("input",e=>S.opts.colorText=e.target.value);
  $("#opt-color-hl").addEventListener("input",e=>S.opts.colorHl=e.target.value);
  $("#opt-fades").addEventListener("change",e=>S.opts.fades=e.target.checked);
  $("#opt-zoom").addEventListener("change",e=>S.opts.zoom=e.target.checked);
  $("#opt-watermark").addEventListener("change",e=>{S.opts.watermark=e.target.checked;$("#wm-group").style.display=e.target.checked?"block":"none";});
  $("#opt-wm-text").addEventListener("input",e=>S.opts.wmText=e.target.value);
}
boot();
