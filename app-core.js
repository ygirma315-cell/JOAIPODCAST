"use strict";

/* ================= LEXICONS ================= */
const AROUSAL={amazing:3,awesome:3,incredible:4,unbelievable:4,insane:4,crazy:3,wild:3,epic:3,legendary:3,unreal:3,mindblowing:5,spectacular:3,phenomenal:4,thrilling:3,stunning:3,breathtaking:4,explosive:4,huge:2,massive:3,shocking:4,shocked:3,stunned:3,speechless:4,whoa:3,wow:3,omg:4,suddenly:2,unexpected:3,twist:3,revealed:3,reveal:3,exposed:4,secret:3,hidden:2,forbidden:3,banned:3,hilarious:4,funny:2,ridiculous:3,absurd:3,laughing:2,joke:2,hysterical:4,fight:3,battle:3,war:3,destroy:4,destroyed:4,demolished:4,crushed:3,brutal:4,ruthless:3,furious:4,rage:4,angry:2,outraged:4,scandal:4,drama:3,betrayed:4,betrayal:4,lied:3,attacked:3,terrifying:4,horrifying:4,scary:3,nightmare:3,disaster:4,catastrophe:4,deadly:4,dangerous:3,panic:4,chaos:4,emergency:3,fatal:4,best:2,worst:3,greatest:3,biggest:2,impossible:3,never:2,ultimate:3,perfect:2,freaking:3,bonkers:3,nuts:2,genius:3,million:3,billion:4,jackpot:4,free:2,broke:3,bankrupt:4,winning:2,discovered:3,breakthrough:4,finally:2,proof:3,truth:3,fake:3,scam:4,hack:3,mistake:2,failed:2,success:2};
const HOOK_PHRASES=["you won't believe","you wont believe","listen to this","here's the secret","here's the thing","here's why","here's how","here is the thing","here is why","here is how","let me tell you","let me show you","what happened next","wait for it","watch this","check this out","the craziest part","the best part","the worst part","the biggest mistake","the number one","the truth is","the truth about","nobody talks about","no one talks about","nobody tells you","no one tells you","i can't believe","this changed everything","this changes everything","you need to know","you have to see","you have to hear","stop doing this","stop scrolling","i was wrong about","everyone gets this wrong","most people don't know","most people dont know","did you know","have you ever","imagine if","picture this","true story","fun fact","pay attention","this is important","this is huge","big announcement","i have a confession","story time","plot twist"];
const PUNCHLINE_MARKERS=["and that's why","and that is why","and that's how","turns out","it turns out","long story short","moral of the story","lesson learned","end of story","and the rest is history","boom","period","mic drop","that's it","that is it","and it worked","never again","the rest is history","case closed"];
const STOPWORDS=new Set(["a","an","the","and","or","but","if","then","than","so","of","to","in","on","at","by","for","with","about","as","is","am","are","was","were","be","been","being","do","does","did","doing","have","has","had","having","will","would","can","could","should","shall","may","might","must","i","me","my","mine","we","us","our","ours","you","your","yours","he","him","his","she","her","hers","it","its","they","them","their","theirs","this","that","these","those","what","which","who","whom","when","where","why","how","not","no","nor","only","all","any","both","each","few","more","most","other","some","up","down","out","off","over","under","into","from","again","once","also","well","like","get","got","go","going","went","one","two","really","thing","things","kind","sort","lot","bit","way","yeah","yes","okay","ok","um","uh","gonna","wanna","know","mean","right","just","now","here","there","very","quite"]);
const CONTEXT_STARTERS=new Set(["that","that's","this","these","those","it","it's","its","he","she","they","him","her","them","his","hers","their","which","so","because","but","and","also","then","therefore","however","anyway","anyways","meanwhile","instead","otherwise","plus","besides","still","yet","again"]);
const FEATURE_LABELS={audio_energy_mean:"sustained energy",audio_energy_peak:"energy spike",audio_burst:"burst moment",audio_payoff:"payoff moment",text_arousal:"high-arousal wording",text_question:"question",text_exclamation:"exclamation",text_hook_phrase:"hook phrase",text_punchline:"punchline closer",text_tfidf:"distinct keywords",text_repetition:"callback phrase",struct_position:"strong position",struct_speech_density:"dense speech",struct_self_contained:"self-contained",struct_complete_ending:"complete thought",text_hook_start:"opens with a hook",text_payoff_end:"ends on a payoff",duration_fit:"ideal length"};
const WEIGHTS={audio_energy_mean:1.0,audio_energy_peak:1.2,audio_burst:1.5,audio_payoff:1.3,text_arousal:1.6,text_question:0.8,text_exclamation:0.9,text_hook_phrase:1.8,text_punchline:1.0,text_tfidf:1.1,text_repetition:0.8,struct_position:0.5,struct_speech_density:0.9,struct_self_contained:1.0,struct_complete_ending:1.3,text_hook_start:2.0,text_payoff_end:1.2,duration_fit:1.4};

/* ================= STATE ================= */
const S={videoFile:null,videoURL:null,videoDuration:0,sentences:[],candidates:[],selected:[],dropped:new Set(),added:new Set(),audioEnergy:null,audioStats:null,
  opts:{target_s:120,count:1,aspect:"9:16",capTemplate:"none",capPos:"bottom",capSize:"m",captions:false,fades:true,zoom:true,watermark:false,wmText:"",colorText:"#FFFF00",colorHl:"#FFFFFF"},
  exporting:false,cancelExport:false};
let ytReady=false,manualReady=false,aiReady=false;

/* ================= HELPERS ================= */
const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));
function arrMin(a){let m=Infinity;for(let i=0;i<a.length;i++)if(a[i]<m)m=a[i];return m;}
function arrMax(a){let m=-Infinity;for(let i=0;i<a.length;i++)if(a[i]>m)m=a[i];return m;}
function esc(s){return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function showAlert(m){const e=$("#alert");e.textContent=m;e.hidden=!m;if(m)e.scrollIntoView({block:"nearest"});}
function fmtTime(s){s=Math.max(0,Math.round(s||0));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return(h?h+":"+String(m).padStart(2,"0"):m)+":"+String(sec).padStart(2,"0");}
function fmtBytes(b){if(b>=1e9)return(b/1e9).toFixed(2)+" GB";if(b>=1e6)return(b/1e6).toFixed(1)+" MB";return Math.round(b/1e3)+" KB";}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function goStep(n){for(let i=1;i<=5;i++)$("#panel-"+i).hidden=i!==n;$$(".step").forEach(el=>{const s=Number(el.dataset.step);el.classList.toggle("active",s===n);el.classList.toggle("done",s<n);});showAlert("");}
function infoGrid(sel,cells){const el=$(sel);el.innerHTML="";cells.forEach(([k,v],i)=>{const d=document.createElement("div");d.className="cell";d.style.animationDelay=(i*60)+"ms";d.innerHTML='<div class="k"></div><div class="v"></div>';d.querySelector(".k").textContent=k;d.querySelector(".v").textContent=v;el.appendChild(d);});el.hidden=false;}
function buildSegCtrl(sel,vals,labels,key,def){const box=$(sel);if(!box)return;box.innerHTML="";vals.forEach((v,i)=>{const b=document.createElement("button");b.type="button";b.textContent=labels?labels[i]:String(v);if(String(def??S.opts[key])===String(v))b.classList.add("sel");b.addEventListener("click",()=>{S.opts[key]=v;box.querySelectorAll("button").forEach(x=>x.classList.remove("sel"));b.classList.add("sel");});box.appendChild(b);});}
function bindDrop(zone,inp,cb){const z=$(zone),i=$(inp);z.addEventListener("click",()=>i.click());z.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();i.click();}});i.addEventListener("change",()=>{if(i.files[0])cb(i.files[0]);});["dragover","dragenter"].forEach(ev=>z.addEventListener(ev,e=>{e.preventDefault();z.classList.add("drag");}));["dragleave","drop"].forEach(ev=>z.addEventListener(ev,e=>{e.preventDefault();z.classList.remove("drag");}));z.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)cb(f);});}
function durationWindow(targetS){const ideal=Math.max(15,targetS||120);const minS=Math.max(ideal-15,Math.round(ideal*0.875));const maxS=Math.min(ideal+20,Math.round(ideal*1.167));return{ideal,minS,maxS};}

/* ================= LOGIN GATE ================= */
const GATE_K="am9mcmVpbmQ6ZnJlaW5k";
function gateOK(u,p){try{return btoa(u.trim().toLowerCase()+":"+p)===GATE_K;}catch(e){return false;}}
function unlockGate(){const g=$("#login-gate");g.classList.add("fade-out");setTimeout(()=>{g.classList.add("hidden");document.body.style.overflow="";},650);const lo=$("#logout");if(lo)lo.style.display="inline-flex";}
function initGate(){const g=$("#login-gate");if(!g)return;
  const lo=$("#logout");
  if(lo)lo.addEventListener("click",()=>{localStorage.removeItem("vs_member");location.reload();});
  if(localStorage.getItem("vs_member")==="1"){g.classList.add("hidden");if(lo)lo.style.display="inline-flex";return;}
  document.body.style.overflow="hidden";
  const tt=$("#theme-toggle");
  function setTheme(light){g.classList.toggle("light",light);tt.textContent=light?"\ud83c\udf19":"\u2600\ufe0f";try{localStorage.setItem("vs_theme",light?"light":"dark");}catch(e){}}
  tt.onclick=()=>setTheme(!g.classList.contains("light"));
  setTheme(localStorage.getItem("vs_theme")==="light");
  const plP=$("#plan-pro"),plF=$("#plan-free"),paneP=$("#pane-pro"),paneF=$("#pane-free");
  function selPlan(pro){plP.classList.toggle("sel",pro);plF.classList.toggle("sel",!pro);paneP.style.display=pro?"flex":"none";paneF.style.display=pro?"none":"block";}
  plP.onclick=()=>selPlan(true);plF.onclick=()=>selPlan(false);
  plP.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();selPlan(true);}};
  plF.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();selPlan(false);}};
  selPlan(true);
  $("#pw-eye").onclick=()=>{const p=$("#login-pass");p.type=p.type==="password"?"text":"password";};
  $("#login-form").addEventListener("submit",e=>{e.preventDefault();
    const u=$("#login-user").value,p=$("#login-pass").value,err=$("#login-err"),card=$("#login-card");
    if(gateOK(u,p)){err.textContent="";localStorage.setItem("vs_member","1");unlockGate();}
    else{card.classList.remove("shake");void card.offsetWidth;card.classList.add("shake");err.textContent="Hmm, that's not it \u2014 the free plan is for Friendship members only.";$("#login-pass").value="";}});}

/* ================= STEP 1: VIDEO ================= */
function handleVideo(file){if(!file)return;if(S.videoURL)URL.revokeObjectURL(S.videoURL);S.videoFile=file;S.videoURL=URL.createObjectURL(file);const v=document.createElement("video");v.preload="metadata";v.onloadedmetadata=()=>{S.videoDuration=v.duration;infoGrid("#video-info",[["File",file.name],["Size",fmtBytes(file.size)],["Duration",fmtTime(v.duration)],["Resolution",v.videoWidth+"\u00d7"+v.videoHeight]]);$("#to-step-2").disabled=false;};v.src=S.videoURL;}

/* ================= STEP 2: TRANSCRIPT ================= */
function parseTSTime(s){const m=s.match(/(\d+):(\d+):(\d+)[,\.](\d+)/);if(!m)return 0;return+m[1]*3600+ +m[2]*60+ +m[3]+ +m[4]/1000;}
function parseSRT(t){const out=[];for(const blk of t.trim().split(/\n\n+/)){const lines=blk.trim().split("\n");let tsL=null,tsI=-1;for(let i=0;i<lines.length;i++)if(lines[i].includes("-->")){tsL=lines[i];tsI=i;break;}if(!tsL)continue;const p=tsL.split("-->").map(s=>s.trim());const start=parseTSTime(p[0]),end=parseTSTime(p[1]);const txt=lines.slice(tsI+1).join(" ").replace(/<[^>]+>/g,"").trim();if(txt&&end>start)out.push({start,end,text:txt});}return out;}
function alignTXT(text,dur){const sents=(text.match(/[^.!?]+[.!?]+/g)||[text]).map(s=>s.trim()).filter(Boolean);const words=text.split(/\s+/).filter(Boolean).length;const wps=Math.max(words/Math.max(dur,1),0.5);const out=[];let t=0;for(const s of sents){const w=s.split(/\s+/).filter(Boolean).length;const d=Math.max(w/wps,0.5);out.push({start:t,end:Math.min(t+d,dur),text:s});t+=d;}return out;}
function handleTranscript(fname,text){showAlert("");const t=text.trim();if(t.length<10){showAlert("Transcript is too short.");return;}let sents=[];if(/-->/.test(t)){sents=t.startsWith("WEBVTT")?parseSRT(t.replace(/^WEBVTT[^\n]*\n/,"\n")):parseSRT(t);}else sents=alignTXT(t,S.videoDuration||3600);if(!sents.length){showAlert("Could not parse transcript. Check the format.");return;}S.sentences=sents;manualReady=true;const wc=sents.reduce((n,s)=>n+s.text.split(/\s+/).length,0);const timed=/-->/.test(t);infoGrid("#tr-info",[["Format",timed?"SRT/VTT (timed)":"TXT (estimated)"],["Words",String(wc)],["Sentences",String(sents.length)],["Cover",fmtTime(sents[0].start)+" \u2013 "+fmtTime(sents[sents.length-1].end)]]);}

/* ---- AI Auto-Transcribe (Deepgram) with approximate % progress ---- */
const DEEPGRAM_API_KEY="60b4a66f441c27464b94570702c75acd1ebf2f6f";
async function decodeAudioBuffer(file,onTick){
  onTick&&onTick(6,"Reading video file\u2026");
  const ab=await file.arrayBuffer();
  onTick&&onTick(14,"Opening audio decoder\u2026");
  const ctx=new(window.AudioContext||window.webkitAudioContext)();
  onTick&&onTick(22,"Decoding audio track\u2026");
  const audio=await ctx.decodeAudioData(ab);
  await ctx.close();
  onTick&&onTick(32,"Audio decoded");
  return audio;}
async function resampleTo16kMono(buffer,onTick){
  const targetRate=16000;
  const OfflineCtx=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const frames=Math.max(1,Math.ceil(buffer.duration*targetRate));
  const offline=new OfflineCtx(1,frames,targetRate);
  const src=offline.createBufferSource();src.buffer=buffer;src.connect(offline.destination);src.start(0);
  onTick&&onTick(38,"Resampling to 16kHz mono\u2026");
  /* Fake smooth progress while offline render runs (no native progress API) */
  let fake=38;let alive=true;
  const pulse=setInterval(()=>{if(!alive)return;fake=Math.min(54,fake+1.2);onTick&&onTick(fake,fake<48?"Resampling audio\u2026":"Halfway there \u2014 still preparing\u2026");},280);
  try{const out=await offline.startRendering();alive=false;clearInterval(pulse);onTick&&onTick(56,"Resample complete");return out;}
  catch(e){alive=false;clearInterval(pulse);throw e;}}
function floatTo16BitPCM(float32){const buf=new ArrayBuffer(float32.length*2);const view=new DataView(buf);let offset=0;for(let i=0;i<float32.length;i++,offset+=2){let s=Math.max(-1,Math.min(1,float32[i]));view.setInt16(offset,s<0?s*0x8000:s*0x7FFF,true);}return buf;}
function encodeWav(buffer,onTick){
  onTick&&onTick(60,"Encoding WAV\u2026");
  const numChannels=1,sampleRate=buffer.sampleRate;const samples=buffer.getChannelData(0);const pcm=floatTo16BitPCM(samples);
  const blockAlign=numChannels*2,byteRate=sampleRate*blockAlign,dataSize=pcm.byteLength,headerSize=44;
  const wavBuf=new ArrayBuffer(headerSize+dataSize);const view=new DataView(wavBuf);
  function writeStr(off,str){for(let i=0;i<str.length;i++)view.setUint8(off+i,str.charCodeAt(i));}
  writeStr(0,"RIFF");view.setUint32(4,36+dataSize,true);writeStr(8,"WAVE");
  writeStr(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,numChannels,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,byteRate,true);view.setUint16(32,blockAlign,true);view.setUint16(34,16,true);
  writeStr(36,"data");view.setUint32(40,dataSize,true);
  new Uint8Array(wavBuf,headerSize).set(new Uint8Array(pcm));
  onTick&&onTick(66,"Audio ready for AI");
  return new Blob([wavBuf],{type:"audio/wav"});}
function postDeepgram(wavBlob,onTick){
  return new Promise((resolve,reject)=>{
    const url="https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&utterances=true&language=en";
    const xhr=new XMLHttpRequest();
    xhr.open("POST",url,true);
    xhr.setRequestHeader("Authorization","Token "+DEEPGRAM_API_KEY);
    xhr.setRequestHeader("Content-Type","audio/wav");
    xhr.upload.onprogress=e=>{
      if(e.lengthComputable&&e.total>0){
        const up=e.loaded/e.total;
        const pct=66+up*16; /* 66 → 82 */
        onTick&&onTick(pct,up<0.95?("Uploading to AI \u2014 "+Math.round(up*100)+"%"):"Upload almost done\u2026");
      }else onTick&&onTick(72,"Uploading to speech AI\u2026");
    };
    xhr.upload.onload=()=>onTick&&onTick(84,"AI is listening\u2026 almost there");
    let think=84;const thinkTimer=setInterval(()=>{think=Math.min(94,think+0.6);onTick&&onTick(think,think<90?"AI is listening\u2026":"Almost there \u2014 wrapping up\u2026");},400);
    xhr.onreadystatechange=()=>{
      if(xhr.readyState===4){
        clearInterval(thinkTimer);
        if(xhr.status>=200&&xhr.status<300){
          onTick&&onTick(96,"Building timed script\u2026");
          try{resolve(JSON.parse(xhr.responseText));}catch(e){reject(new Error("Bad AI response"));}
        }else{
          const extra=(xhr.responseText||"").slice(0,180);
          reject(new Error("AI service returned "+xhr.status+(extra?" \u2014 "+extra:"")));
        }
      }
    };
    xhr.onerror=()=>{clearInterval(thinkTimer);reject(new Error("Network error talking to AI"));};
    onTick&&onTick(68,"Starting upload to speech AI\u2026");
    xhr.send(wavBlob);
  });}
async function transcribeWithDeepgram(file,onStatus){
  /* onStatus(message, percent 0-100) */
  const tick=(pct,msg)=>{const p=Math.round(Math.min(100,Math.max(0,pct)));onStatus&&onStatus(msg,p);};
  tick(3,"Starting AI transcription\u2026");
  const decoded=await decodeAudioBuffer(file,tick);
  const mono16k=await resampleTo16kMono(decoded,tick);
  const wavBlob=encodeWav(mono16k,tick);
  const data=await postDeepgram(wavBlob,tick);
  tick(97,"Parsing transcript\u2026");
  const utter=data&&data.results&&data.results.utterances;
  let sents=[];
  if(utter&&utter.length)sents=utter.map(u=>({start:u.start,end:u.end,text:(u.transcript||"").trim()})).filter(s=>s.text);
  else{
    const alt=data&&data.results&&data.results.channels&&data.results.channels[0]&&data.results.channels[0].alternatives&&data.results.channels[0].alternatives[0];
    const words=(alt&&alt.words)||[];
    if(words.length){let cur=[];for(const w of words){cur.push(w);const pw=w.punctuated_word||w.word||"";if(/[.!?]$/.test(pw)||cur.length>28){sents.push({start:cur[0].start,end:cur[cur.length-1].end,text:cur.map(x=>x.punctuated_word||x.word).join(" ")});cur=[];}}if(cur.length)sents.push({start:cur[0].start,end:cur[cur.length-1].end,text:cur.map(x=>x.punctuated_word||x.word).join(" ")});}
  }
  tick(100,"Done!");
  return sents;}

/* ================= STEP 3: OPTIONS ================= */
function initOpts(){
  buildSegCtrl("#opt-duration",[30,45,60,90,120],["30 s","45 s","1 min","1.5 min","2 min"],"target_s",120);
  S.opts.count=1;
  buildSegCtrl("#opt-aspect",["9:16","1:1","16:9"],["\ud83d\udcf1 9:16 vertical","\u25fb 1:1 square","\ud83d\udda5 16:9 wide"],"aspect","9:16");
  buildSegCtrl("#opt-cappos",["bottom","middle","top"],["\u2b07 Bottom","\u25cf Middle","\u2b06 Top"],"capPos","bottom");
  buildSegCtrl("#opt-capsize",["s","m","l"],["Small","Medium","Large"],"capSize","m");
  $$("#tpl-grid .tpl-card").forEach(c=>c.addEventListener("click",()=>{
    const tpl=c.dataset.tpl;S.opts.capTemplate=tpl;S.opts.captions=tpl!=="none";
    $$("#tpl-grid .tpl-card").forEach(x=>x.classList.remove("sel"));c.classList.add("sel");
    const cs=$("#cap-settings");if(cs)cs.style.display=tpl==="none"?"none":"block";
    const cc=$("#cap-custom-group");if(cc)cc.style.display=(tpl==="bold"||tpl==="clean")?"block":"none";
  }));
}

/* ================= SCORING ENGINE ================= */
function tokenize(txt){return txt.toLowerCase().replace(/[^a-z0-9']/g," ").split(/\s+/).filter(Boolean).map(t=>t.replace(/[^a-z0-9']/g,"")).filter(t=>t&&!STOPWORDS.has(t));}
function buildCorpus(sents){const docs=sents.map(s=>tokenize(s.text));const df={};for(const doc of docs){const seen=new Set(doc);for(const t of seen)df[t]=(df[t]||0)+1;}const n=Math.max(docs.length,1);const idf={};for(const[t,c]of Object.entries(df))idf[t]=Math.log(n/(1+c))+1;const vals=Object.values(idf);const meanIdf=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:1;const grams={};for(const doc of docs)for(let k=0;k<doc.length-2;k++){const g=doc[k]+"|"+doc[k+1]+"|"+doc[k+2];grams[g]=(grams[g]||0)+1;}const callbacks=new Set(Object.entries(grams).filter(([,c])=>c>=3).map(([g])=>g));return{idf,meanIdf,callbacks};}
function buildCandidates(sents,idealS){const{minS,ideal}=durationWindow(idealS);const minLen=Math.max(20,minS*0.9);const maxLen=ideal*2.2+40;const lookahead=Math.min(120,Math.max(20,Math.ceil(ideal/1.2)));const cands=[];for(let i=0;i<sents.length;i++){for(let j=i;j<Math.min(i+lookahead,sents.length);j++){const dur=sents[j].end-sents[i].start;if(dur>maxLen)break;if(dur>=minLen){const span=sents.slice(i,j+1),text=span.map(s=>s.text).join(" "),tokens=tokenize(text);cands.push({id:cands.length,sentLo:i,sentHi:j,start:sents[i].start,end:sents[j].end,duration:dur,text,tokens,sentences:span});}}}return cands;}
function extractFeatures(c,corpus,totalDur,ae,ideal,astats){const low=c.text.toLowerCase(),f={};
  f.text_arousal=c.tokens.reduce((s,t)=>s+(AROUSAL[t]||0),0)/Math.max(c.tokens.length,1);
  f.text_question=low.includes("?")?1:0;f.text_exclamation=Math.min((c.text.match(/!/g)||[]).length,3)/3;
  f.text_hook_phrase=HOOK_PHRASES.some(p=>low.includes(p))?1:0;f.text_punchline=PUNCHLINE_MARKERS.some(p=>low.includes(p))?1:0;
  f.text_tfidf=c.tokens.reduce((s,t)=>s+(corpus.idf[t]||corpus.meanIdf),0)/Math.max(c.tokens.length,1);
  let rep=0;for(let k=0;k<c.tokens.length-2;k++)if(corpus.callbacks.has(c.tokens[k]+"|"+c.tokens[k+1]+"|"+c.tokens[k+2]))rep++;f.text_repetition=Math.min(rep/Math.max(c.tokens.length,1),1);
  const firstS=c.sentences[0].text,lastS=c.sentences[c.sentences.length-1].text;const firstLow=firstS.toLowerCase();
  f.text_hook_start=HOOK_PHRASES.some(p=>firstLow.includes(p))||firstS.includes("?")?1:(tokenize(firstS).some(t=>(AROUSAL[t]||0)>=3)?0.6:0);
  const lastLow=lastS.toLowerCase();f.text_payoff_end=PUNCHLINE_MARKERS.some(p=>lastLow.includes(p))||/!\s*$/.test(lastS.trim())?1:0;
  f.struct_self_contained=CONTEXT_STARTERS.has(c.tokens[0]||"")?0:1;f.struct_complete_ending=/[.!?]\s*$/.test(c.text.trim())?1:0;
  f.struct_speech_density=Math.min(c.tokens.length/Math.max(c.duration,1)/3,1);
  const rp=c.start/Math.max(totalDur,1);f.struct_position=(rp<0.12||rp>0.82)?0.8:0;
  const prefer=ideal*1.25;const sigma=Math.max(ideal*0.5,12);f.duration_fit=Math.exp(-((c.duration-prefer)**2)/(2*sigma*sigma));
  if(ae&&ae.length&&astats){const i0=Math.max(0,Math.floor(c.start)),i1=Math.min(ae.length-1,Math.floor(c.end));const sl=ae.slice(i0,i1+1);
    if(sl.length){const mean=sl.reduce((a,b)=>a+b,0)/sl.length,peak=arrMax(sl);f.audio_energy_mean=mean;f.audio_energy_peak=peak;
      let maxZ=0;for(const x of sl){const z=(x-astats.mean)/astats.std;if(z>maxZ)maxZ=z;}f.audio_burst=Math.min(Math.max(maxZ,0)/3,1);
      let pay=0;const quiet=astats.mean*0.5,loud=astats.mean*1.4;for(let k=1;k<sl.length;k++)if(sl[k-1]<quiet&&sl[k]>loud)pay++;f.audio_payoff=Math.min(pay/2,1);}
    else{f.audio_energy_mean=f.audio_energy_peak=f.audio_burst=f.audio_payoff=0;}}
  else{f.audio_energy_mean=f.audio_energy_peak=f.audio_burst=f.audio_payoff=0;}return f;}
function scoreAll(cands,corpus,totalDur,ae,ideal,astats){if(!cands.length)return[];const fns=Object.keys(WEIGHTS);for(const c of cands)c.rawF=extractFeatures(c,corpus,totalDur,ae,ideal,astats);for(const fn of fns){const vals=cands.map(c=>c.rawF[fn]||0),lo=arrMin(vals),hi=arrMax(vals);for(const c of cands){c.normF=c.normF||{};c.normF[fn]=hi>lo?((c.rawF[fn]||0)-lo)/(hi-lo):0;}}for(const c of cands){c.score=fns.reduce((s,fn)=>s+WEIGHTS[fn]*(c.normF[fn]||0),0);c.reasons=fns.filter(fn=>FEATURE_LABELS[fn]).map(fn=>({fn,v:WEIGHTS[fn]*(c.normF[fn]||0)})).sort((a,b)=>b.v-a.v).slice(0,3).filter(x=>x.v>0.15).map(x=>FEATURE_LABELS[x.fn]);}return cands.sort((a,b)=>b.score-a.score);}
function jaccard(a,b){let inter=0;for(const t of a)if(b.has(t))inter++;const uni=a.size+b.size-inter;return uni?inter/uni:0;}
function selectTop(scored,n){if(!scored.length)return[];return[scored[0]];}
function computeSentenceScores(sentences,corpus,ae,astats){const raw=sentences.map(s=>{const low=s.text.toLowerCase();const toks=tokenize(s.text);let sc=0;sc+=toks.reduce((a,t)=>a+(AROUSAL[t]||0),0)/Math.max(toks.length,1)*1.6;if(low.includes("?"))sc+=0.8;sc+=Math.min((s.text.match(/!/g)||[]).length,3)/3*0.9;if(HOOK_PHRASES.some(p=>low.includes(p)))sc+=1.8;if(PUNCHLINE_MARKERS.some(p=>low.includes(p)))sc+=1.0;sc+=toks.reduce((a,t)=>a+(corpus.idf[t]||corpus.meanIdf),0)/Math.max(toks.length,1)*0.5;if(ae&&ae.length&&astats){const i0=Math.max(0,Math.floor(s.start)),i1=Math.min(ae.length-1,Math.floor(s.end));const sl=ae.slice(i0,i1+1);if(sl.length){const mean=sl.reduce((a,b)=>a+b,0)/sl.length,peak=arrMax(sl);sc+=mean*1.0+peak*0.6;let maxZ=0;for(const x of sl){const z=(x-astats.mean)/astats.std;if(z>maxZ)maxZ=z;}sc+=Math.min(Math.max(maxZ,0)/3,1)*1.2;}}const firstTok=toks[0]||"";if(CONTEXT_STARTERS.has(firstTok))sc*=0.7;const wc=s.text.split(/\s+/).filter(Boolean).length;if(wc>=3&&wc<=22)sc+=0.3;if(/[.!?]\s*$/.test(s.text.trim()))sc+=0.15;return sc;});const lo=arrMin(raw),hi=arrMax(raw);return raw.map(v=>hi>lo?(v-lo)/(hi-lo):0.5);}
function compressRegion(region,sentences,sentScore,targetDur,minFloor){const lo=region.sentLo,hi=region.sentHi;if(hi<=lo)return[{sentLo:lo,sentHi:lo,cs:sentences[lo].start,ce:sentences[lo].end}];const keep=new Set();for(let i=lo;i<=hi;i++)keep.add(i);function totalDur(){let d=0;for(const i of keep)d+=Math.max(sentences[i].end-sentences[i].start,0);return d;}const floorDur=Math.max(minFloor||targetDur*0.875,Math.min(targetDur*0.7,targetDur-20));let guard=0;while(totalDur()>targetDur*1.02&&keep.size>1&&guard++<600){const arr=[...keep].sort((a,b)=>a-b);let worstIdx=-1,worstScore=Infinity;if(arr.length>2){for(let k=1;k<arr.length-1;k++){const i=arr[k];const sc=sentScore[i]||0;if(sc<worstScore){worstScore=sc;worstIdx=i;}}}if(worstIdx<0){const first=arr[0],last=arr[arr.length-1];worstIdx=((sentScore[last]||0)<=(sentScore[first]||0)+0.05)?last:first;}const dropDur=Math.max(sentences[worstIdx].end-sentences[worstIdx].start,0);if(totalDur()-dropDur<floorDur&&totalDur()<=targetDur*1.15)break;keep.delete(worstIdx);}const arr=[...keep].sort((a,b)=>a-b);if(!arr.length)return[{sentLo:lo,sentHi:lo,cs:sentences[lo].start,ce:Math.min(sentences[lo].end,sentences[lo].start+targetDur)}];const cuts=[];let runStart=arr[0];for(let k=0;k<arr.length;k++){const atEnd=k+1>=arr.length||arr[k+1]!==arr[k]+1;if(atEnd){const runEnd=arr[k];cuts.push({sentLo:runStart,sentHi:runEnd,cs:sentences[runStart].start,ce:sentences[runEnd].end});if(k+1<arr.length)runStart=arr[k+1];}}return cuts;}
function refineCutBounds(cut){const ae=S.audioEnergy;let cs=cut.cs,ce=cut.ce;if(ae&&ae.length){let g=0;while(g++<6&&ce-cs>2){const i=Math.floor(cs);if(i>=0&&i<ae.length&&ae[i]<0.04)cs+=0.25;else break;}g=0;while(g++<6&&ce-cs>2){const i=Math.floor(ce);if(i>=0&&i<ae.length&&ae[i]<0.04)ce-=0.25;else break;}}cs=Math.max(0,cs-0.08);return{cs,ce};}
function cutDurOf(cuts){return(cuts||[]).reduce((n,c)=>n+Math.max(c.ce-c.cs,0),0);}
function avgCutScore(cuts,sentScore){if(!cuts||!cuts.length)return 0;let s=0,n=0;for(const c of cuts){for(let i=c.sentLo;i<=c.sentHi;i++){s+=sentScore[i]||0;n++;}}return n?s/n:0;}
function hardTrimCuts(cuts,maxS){if(!cuts||!cuts.length)return cuts||[];let d=cutDurOf(cuts);if(d<=maxS)return cuts;let need=d-maxS;for(let i=cuts.length-1;i>=0&&need>0.01;i--){const c=cuts[i];const room=Math.max(0,(c.ce-c.cs)-0.45);const take=Math.min(room,need);c.ce-=take;need-=take;}return cuts.filter(c=>c.ce-c.cs>=0.4);}
function finalizeRegionCuts(region,sentences,sentScore,ideal,minS,maxS){const rawCuts=compressRegion(region,sentences,sentScore,ideal,minS);let cuts=rawCuts.map(c=>{const rb=refineCutBounds(c);return{cs:rb.cs,ce:rb.ce,sentLo:c.sentLo,sentHi:c.sentHi};}).filter(c=>c.ce-c.cs>=0.4);cuts.sort((a,b)=>a.cs-b.cs);const merged=[];for(const c of cuts){const last=merged[merged.length-1];if(last&&c.cs-last.ce<0.2){last.ce=Math.max(last.ce,c.ce);last.sentHi=c.sentHi;}else merged.push({cs:c.cs,ce:c.ce,sentLo:c.sentLo,sentHi:c.sentHi});}while(cutDurOf(merged)>maxS&&merged.length>1){let wi=0,ws=Infinity;for(let i=0;i<merged.length;i++){if(i===0&&merged.length>2)continue;const sc=avgCutScore([merged[i]],sentScore);if(sc<ws){ws=sc;wi=i;}}merged.splice(wi,1);}cuts=hardTrimCuts(merged,maxS);region.cuts=cuts;region.cutDuration=cutDurOf(cuts);region._avgScore=avgCutScore(cuts,sentScore);return region;}
function pickBestSingleClip(scored,sentences,sentScore,targetS){const{ideal,minS,maxS}=durationWindow(targetS);if(!scored.length)return[];const pool=scored.slice(0,50);let fallback=null;let fallbackDist=Infinity;for(const cand of pool){const trial={...cand,cuts:null,cutDuration:0};finalizeRegionCuts(trial,sentences,sentScore,ideal,minS,maxS);const d=trial.cutDuration||0;if(d>=minS&&d<=maxS&&trial.cuts&&trial.cuts.length){cand.cuts=trial.cuts;cand.cutDuration=trial.cutDuration;cand._avgScore=trial._avgScore;return[cand];}if(trial.cuts&&trial.cuts.length){const dist=Math.abs(d-ideal)+(d>maxS?(d-maxS)*2:0)+(d<minS?(minS-d)*1.5:0);if(dist<fallbackDist){fallbackDist=dist;fallback=trial;fallback._src=cand;}}}if(fallback&&fallback._src){let cuts=hardTrimCuts(fallback.cuts.map(c=>({...c})),maxS);if(cutDurOf(cuts)>maxS)cuts=hardTrimCuts(cuts,maxS);const src=fallback._src;src.cuts=cuts;src.cutDuration=cutDurOf(cuts);src._avgScore=avgCutScore(cuts,sentScore);if(src.cutDuration>maxS+0.5){src.cuts=hardTrimCuts(src.cuts,maxS);src.cutDuration=cutDurOf(src.cuts);}return src.cuts&&src.cuts.length?[src]:[];}return[];}
function buildMomentCuts(regions,sentences,sentScore,totalTargetS){const{ideal,minS,maxS}=durationWindow(totalTargetS);for(const r of regions)finalizeRegionCuts(r,sentences,sentScore,ideal,minS,maxS);return regions;}
async function analyzeAudio(file){try{const ab=await file.arrayBuffer();const ctx=new(window.AudioContext||window.webkitAudioContext)();const audio=await ctx.decodeAudioData(ab);const data=audio.getChannelData(0),sr=audio.sampleRate,dur=audio.duration;const energy=[];for(let i=0;i<Math.ceil(dur);i++){const from=i*sr,to=Math.min(data.length,(i+1)*sr);let sum=0;for(let j=from;j<to;j++)sum+=data[j]*data[j];energy.push(Math.sqrt(sum/Math.max(to-from,1)));}const eMax=Math.max(arrMax(energy),0.0001);await ctx.close();return energy.map(v=>v/eMax);}catch(e){console.warn("Audio analysis failed:",e);return null;}}
