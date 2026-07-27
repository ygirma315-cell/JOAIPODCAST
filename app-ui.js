"use strict";

/* ================= STEP 4: ANALYZE ================= */
const STAGES=[["probe","Reading video & transcript"],["audio","Analyzing audio energy"],["cands","Finding good regions"],["score","Scoring 18 virality signals"],["select","Picking distinct moments"],["refine","Cutting out the best lines"]];
const STAGE_PCT={probe:12,audio:38,cands:56,score:74,select:88,refine:100};
function initStages(){const ul=$("#stages");ul.innerHTML="";for(const[id,label]of STAGES){const li=document.createElement("li");li.id="st-"+id;li.innerHTML='<span class="st-ic">\u25cb</span><span class="st-label"></span><span class="st-pct"></span>';li.querySelector(".st-label").textContent=label;ul.appendChild(li);}}
function setStage(id,state){const li=$("#st-"+id);if(!li)return;li.classList.remove("st-active","st-done");if(state==="active"){li.classList.add("st-active");li.querySelector(".st-pct").textContent="";}
  if(state==="done"){li.classList.add("st-done");li.querySelector(".st-ic").textContent="\u2713";li.querySelector(".st-pct").textContent=STAGE_PCT[id]+"%";}}
async function generate(){goStep(4);initStages();const bar=$("#job-bar");const title=$("#progress-title");
  function setBar(pct,label){bar.style.width=pct+"%";title.textContent=label+" \u2014 "+pct+"% complete";}
  setBar(4,"Starting\u2026");
  setStage("probe","active");await sleep(250);setStage("probe","done");setBar(12,"Probing video");
  setStage("audio","active");setBar(14,"Analyzing audio");
  if(!S.audioEnergy&&S.videoFile)S.audioEnergy=await analyzeAudio(S.videoFile);
  if(S.audioEnergy&&S.audioEnergy.length){const m=S.audioEnergy.reduce((a,b)=>a+b,0)/S.audioEnergy.length;const varr=S.audioEnergy.reduce((a,b)=>a+(b-m)*(b-m),0)/S.audioEnergy.length;S.audioStats={mean:m,std:Math.sqrt(varr)||0.001};}
  setStage("audio","done");setBar(38,"Audio done");
  setStage("cands","active");setBar(40,"Scanning the transcript for good regions");await sleep(120);
  const corpus=buildCorpus(S.sentences);const cands=buildCandidates(S.sentences,S.opts.target_s);
  setStage("cands","done");setBar(56,"Regions ready");
  setStage("score","active");setBar(58,"Scoring moments");await sleep(120);
  const scored=scoreAll(cands,corpus,S.videoDuration||(S.sentences.length?S.sentences[S.sentences.length-1].end:600),S.audioEnergy,S.opts.target_s,S.audioStats);
  setStage("score","done");setBar(74,"Scored all moments");
  setStage("select","active");setBar(76,"Selecting best moments");await sleep(120);
  const picked=selectTop(scored,S.opts.count);
  setStage("select","done");setBar(88,"Moments selected");
  setStage("refine","active");setBar(90,"Reading each line \u2014 keeping only the good parts");
  const sentScore=computeSentenceScores(S.sentences,corpus,S.audioEnergy,S.audioStats);
  buildMomentCuts(picked,S.sentences,sentScore,S.opts.target_s);
  setStage("refine","done");setBar(100,"Done! Starting render");
  S.candidates=scored;S.selected=picked.filter(p=>p.cuts&&p.cuts.length);
  if(!S.selected.length){showAlert("No clips found \u2014 the transcript may be too short. Try a shorter target duration.");goStep(3);return;}
  await sleep(400);startRender();}

/* ================= STEP 5: RENDER + FINAL VIDEO ================= */
async function startRender(){goStep(5);
  $("#render-box").style.display="block";$("#final-box").style.display="none";
  const p=$("#player");
  if(p.src!==S.videoURL){p.src=S.videoURL;
    await new Promise(r=>{if(p.readyState>=1)r();else p.addEventListener("loadedmetadata",()=>r(),{once:true});});}
  const moments=S.selected;
  const totalCuts=moments.reduce((n,m)=>n+(m.cuts?m.cuts.length:0),0);
  const tot=moments.reduce((n,m)=>n+(m.cutDuration||0),0);
  $("#render-info").textContent=moments.length+" best moment"+(moments.length===1?"":"s")+" \u00b7 "+totalCuts+" line"+(totalCuts===1?"":"s")+" stitched together (filler cut out) \u00b7 final video \u2248 "+fmtTime(tot);
  exportClips();}

/* ================= CAPTION TEMPLATES ================= */
const CAP_MAX_WORDS=6;
function capStyle(opt){
  switch(opt.capTemplate){
    case "clean":return{upper:false,mono:false,text:"#FFFFFF",hl:opt.colorHl==="#FFFFFF"?"#FFD84D":opt.colorHl,glow:"rgba(0,0,0,.9)",box:false};
    case "mono":return{upper:false,mono:true,text:"#E8E8E8",hl:"#7CF5B8",glow:"rgba(0,0,0,.9)",box:false};
    case "neon":return{upper:true,mono:false,text:"#7DF9FF",hl:"#FF3CAC",glow:"rgba(0,229,255,.85)",box:false};
    case "boxed":return{upper:true,mono:false,text:"#FFFFFF",hl:"#FFE400",glow:null,box:true};
    default:return{upper:true,mono:false,text:opt.colorText||"#FFFF00",hl:opt.colorHl||"#FFFFFF",glow:"rgba(0,0,0,.9)",box:false};
  }}
function wordSpans(sent){if(sent._words)return sent._words;const words=sent.text.split(/\s+/).filter(Boolean);const dur=Math.max(sent.end-sent.start,0.3);const per=dur/words.length;sent._words=words.map((w,i)=>({w,t0:sent.start+i*per,t1:sent.start+(i+1)*per}));return sent._words;}
function capChunk(sent,t){const ws=wordSpans(sent);let idx=ws.findIndex(x=>t>=x.t0&&t<x.t1);if(idx<0)idx=t>=sent.end?ws.length-1:0;const c0=Math.floor(idx/CAP_MAX_WORDS)*CAP_MAX_WORDS;return{words:ws.slice(c0,c0+CAP_MAX_WORDS),active:idx-c0};}
function cropRect(vw,vh,cw,ch){const sc=Math.max(cw/vw,ch/vh);const sw=cw/sc,sh=ch/sc;return{sx:(vw-sw)/2,sy:(vh-sh)/2,sw,sh};}
function layoutWords(ctx,words,maxW){const lines=[];let line=[];for(const w of words){const test=line.concat([w]).map(x=>x.w).join(" ");if(ctx.measureText(test).width>maxW&&line.length){lines.push(line);line=[w];}else line.push(w);}if(line.length)lines.push(line);return lines.slice(0,2);}
function drawCaption(ctx,cw,ch,t,opt){
  if(!opt.captions||opt.capTemplate==="none")return;
  const sent=S.sentences.find(s=>t>=s.start&&t<=s.end);if(!sent)return;
  const{words,active}=capChunk(sent,t);
  const st=capStyle(opt);
  const sizeMap={s:0.042,m:0.055,l:0.07};
  const fs=Math.round(cw*(sizeMap[opt.capSize]||0.055));
  ctx.font="900 "+(st.mono?Math.round(fs*0.9)+"px Menlo,Consolas,monospace":fs+"px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif");
  ctx.textAlign="center";ctx.textBaseline="middle";
  const lines=layoutWords(ctx,words,cw*0.86);const lh=fs*1.35;
  const posMap={bottom:0.86,middle:0.55,top:0.16};
  const anchor=ch*(posMap[opt.capPos]||0.86);
  const baseY=anchor-(lines.length-1)*lh;
  let wi=0;
  lines.forEach((line,li)=>{
    const texts=line.map(x=>st.upper?x.w.toUpperCase():x.w);
    const widths=texts.map(s2=>ctx.measureText(s2).width);
    const gap=fs*0.32;
    const totW=widths.reduce((a,b)=>a+b,0)+gap*(texts.length-1);
    let x=cw/2-totW/2;const y=baseY+li*lh;
    if(st.box){ctx.save();ctx.fillStyle="rgba(0,0,0,.78)";ctx.fillRect(cw/2-totW/2-fs*0.45,y-lh*0.52,totW+fs*0.9,lh*1.04);ctx.restore();}
    texts.forEach((s2,i)=>{const isOn=wi===active;ctx.save();
      if(st.glow){ctx.shadowColor=st.glow;ctx.shadowBlur=fs*0.35;ctx.lineWidth=Math.max(fs*0.12,3);ctx.strokeStyle="rgba(0,0,0,.85)";}
      const cx=x+widths[i]/2;
      if(isOn){ctx.translate(cx,y);ctx.scale(1.12,1.12);ctx.translate(-cx,-y);}
      if(st.glow)ctx.strokeText(s2,cx,y);
      ctx.fillStyle=isOn?st.hl:st.text;ctx.fillText(s2,cx,y);
      ctx.restore();x+=widths[i]+gap;wi++;});});}
function drawWM(ctx,cw,ch,text){if(!text)return;ctx.save();const fs=Math.round(cw*0.03);ctx.font="700 "+fs+"px -apple-system,sans-serif";ctx.textAlign="right";ctx.textBaseline="top";ctx.shadowColor="rgba(0,0,0,.7)";ctx.shadowBlur=6;ctx.fillStyle="rgba(255,255,255,.82)";ctx.fillText(text,cw-fs,fs);ctx.restore();}

/* ================= RENDER ENGINE (multi-cut) ================= */
async function exportClips(){if(S.exporting)return;
  const moments=(S.selected||[]).filter(m=>m.cuts&&m.cuts.length);
  if(!moments.length){showAlert("Nothing to render \u2014 run the analysis first.");goStep(3);return;}
  const opt={...S.opts};S.exporting=true;S.cancelExport=false;
  $("#export-bar").style.width="0%";$("#export-pct").textContent="0%";
  $("#export-log").textContent="Preparing renderer\u2026";
  const p=$("#player");p.muted=true;p.volume=0;
  let cw=1080,ch=1920;if(opt.aspect==="1:1"){cw=1080;ch=1080;}if(opt.aspect==="16:9"){cw=1280;ch=720;}
  const canvas=document.createElement("canvas");canvas.width=cw;canvas.height=ch;const ctx=canvas.getContext("2d");
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  const stream=canvas.captureStream(30);
  try{const ps=p.captureStream?p.captureStream():p.mozCaptureStream?p.mozCaptureStream():null;if(ps)ps.getAudioTracks().forEach(t=>stream.addTrack(t));}catch(e){console.warn("No audio track:",e);}
  let mime="video/webm;codecs=vp9,opus";if(!MediaRecorder.isTypeSupported(mime))mime="video/webm;codecs=vp8,opus";if(!MediaRecorder.isTypeSupported(mime))mime="video/webm";
  const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8_000_000});
  const chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const done=new Promise(res=>{rec.onstop=res;});
  rec.start(250);
  const total=moments.reduce((n,m)=>n+m.cutDuration,0)||1;let rendered=0;const F=0.4,CUTPOP=0.15;
  const totalCutsAll=moments.reduce((n,m)=>n+m.cuts.length,0);let cutIndex=0;
  for(let mi=0;mi<moments.length&&!S.cancelExport;mi++){
    const moment=moments[mi];const cuts=moment.cuts;
    for(let ci=0;ci<cuts.length&&!S.cancelExport;ci++){
      const cut=cuts[ci];cutIndex++;
      const isFirstCutInMoment=ci===0,isLastCutInMoment=ci===cuts.length-1;
      $("#export-log").textContent="\ud83c\udfac Line "+cutIndex+" of "+totalCutsAll+" \u00b7 moment "+(mi+1)+"/"+moments.length+" \u00b7 "+fmtTime(rendered)+" / "+fmtTime(total)+" rendered";
      p.currentTime=cut.cs;
      await new Promise(res=>{const on=()=>{p.removeEventListener("seeked",on);res();};p.addEventListener("seeked",on);});
      try{await p.play();}catch(e){}
      await new Promise(resolve=>{function frame(){if(S.cancelExport){resolve();return;}
        const vw=p.videoWidth||cw,vh=p.videoHeight||ch;
        let cr=cropRect(vw,vh,cw,ch);
        const cutT=p.currentTime-cut.cs,cutDur=Math.max(cut.ce-cut.cs,0.1);
        if(opt.zoom){const zp=Math.min(Math.max(cutT/cutDur,0),1);const z=1+0.06*zp;const sw2=cr.sw/z,sh2=cr.sh/z;cr={sx:cr.sx+(cr.sw-sw2)/2,sy:cr.sy+(cr.sh-sh2)/2,sw:sw2,sh:sh2};}
        /* quick punch-in on every jump cut (except the very first cut of the whole edit) for a snappy, professional feel */
        if(cutT<CUTPOP&&!(mi===0&&ci===0)){const pz=1+0.05*(1-cutT/CUTPOP);const sw3=cr.sw/pz,sh3=cr.sh/pz;cr={sx:cr.sx+(cr.sw-sw3)/2,sy:cr.sy+(cr.sh-sh3)/2,sw:sw3,sh:sh3};}
        ctx.fillStyle="#000";ctx.fillRect(0,0,cw,ch);
        if(p.videoWidth)ctx.drawImage(p,cr.sx,cr.sy,cr.sw,cr.sh,0,0,cw,ch);
        drawCaption(ctx,cw,ch,p.currentTime,opt);
        if(opt.watermark)drawWM(ctx,cw,ch,opt.wmText);
        if(opt.fades){let a=0;
          if(isFirstCutInMoment){const tIn=p.currentTime-cut.cs;if(tIn<F)a=Math.max(a,1-tIn/F);}
          if(isLastCutInMoment){const tOut=cut.ce-p.currentTime;if(tOut<F)a=Math.max(a,1-tOut/F);}
          if(a>0){ctx.fillStyle="rgba(0,0,0,"+Math.min(Math.max(a,0),1).toFixed(3)+")";ctx.fillRect(0,0,cw,ch);}}
        const prog=(rendered+Math.max(p.currentTime-cut.cs,0))/total*100;const pct=Math.min(Math.round(prog),99);
        $("#export-bar").style.width=pct+"%";$("#export-pct").textContent=pct+"%";
        if(p.currentTime>=cut.ce||p.ended){resolve();return;}
        requestAnimationFrame(frame);}
        frame();});
      p.pause();rendered+=cut.ce-cut.cs;
    }
  }
  rec.stop();await done;
  p.muted=false;p.volume=1;
  S.exporting=false;
  if(S.cancelExport){$("#export-log").textContent="Render cancelled.";$("#export-bar").style.width="0%";$("#export-pct").textContent="";goStep(3);return;}
  $("#export-bar").style.width="100%";$("#export-pct").textContent="100%";
  const blob=new Blob(chunks,{type:"video/webm"});const blobUrl=URL.createObjectURL(blob);
  const fp=$("#final-player");fp.src=blobUrl;
  const dl=$("#download");dl.href=blobUrl;dl.download="podcast_clip_"+Date.now()+".webm";
  $("#final-info").innerHTML="\u2705 Render complete! <strong>"+moments.length+" moment"+(moments.length===1?"":"s")+"</strong> \u00b7 <strong>"+totalCutsAll+" line"+(totalCutsAll===1?"":"s")+" stitched"+(totalCutsAll>moments.length?" (filler cut out)":"")+"</strong> \u00b7 Total length: <strong>"+fmtTime(total)+"</strong> \u00b7 "+fmtBytes(blob.size)+" \u00b7 WebM (use CloudConvert for MP4)";
  $("#render-box").style.display="none";$("#final-box").style.display="block";
  try{fp.play();}catch(e){}}

/* ================= BOOT ================= */
function boot(){
  initGate();initOpts();goStep(1);
  bindDrop("#video-drop","#video-input",handleVideo);
  bindDrop("#tr-drop","#tr-input",f=>{const rd=new FileReader();rd.onload=()=>handleTranscript(f.name,String(rd.result||""));rd.readAsText(f);});
  let deb;$("#tr-text").addEventListener("input",()=>{clearTimeout(deb);deb=setTimeout(()=>{const t=$("#tr-text").value.trim();if(t.length>10)handleTranscript(null,t);},700);});
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
  $("#ai-transcribe").addEventListener("click",async()=>{
    if(!S.videoFile){showAlert("Upload a video first (step 1).");goStep(1);return;}
    const btn=$("#ai-transcribe"),st=$("#ai-status"),useBtn=$("#use-ai");
    btn.disabled=true;useBtn.style.display="none";st.textContent="";
    try{
      const sents=await transcribeWithDeepgram(S.videoFile,msg=>{st.textContent="\u23f3 "+msg;});
      if(!sents.length){st.textContent="\u26a0 No speech detected in the audio \u2014 try Manual or YouTube instead.";btn.disabled=false;return;}
      S.sentences=sents;aiReady=true;
      const wc=sents.reduce((n,s)=>n+s.text.split(/\s+/).filter(Boolean).length,0);
      infoGrid("#tr-info",[["Source","AI Speech-to-Text (Deepgram)"],["Words",String(wc)],["Sentences",String(sents.length)],["Cover",fmtTime(sents[0].start)+" \u2013 "+fmtTime(sents[sents.length-1].end)]]);
      st.textContent="\u2713 Transcribed accurately \u2014 hit Use this!";
      useBtn.style.display="block";
    }catch(e){
      console.warn(e);
      st.textContent="\u26a0 AI transcription failed ("+(e&&e.message?e.message:"network error")+") \u2014 try Manual or YouTube instead.";
    }
    btn.disabled=false;});
  $("#use-ai").addEventListener("click",()=>{if(S.sentences.length&&aiReady)goStep(3);});
  $("#to-step-2").addEventListener("click",()=>goStep(2));
  $$("[data-back]").forEach(b=>b.addEventListener("click",()=>goStep(Number(b.dataset.back))));
  $("#generate").addEventListener("click",()=>{
    if(!S.videoFile){showAlert("Load a video first (step 1).");goStep(1);return;}
    if(!S.sentences.length){showAlert("Add a transcript first (step 2) \u2014 AI Auto-Transcribe is the fastest way.");goStep(2);return;}
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
