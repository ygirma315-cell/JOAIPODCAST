"use strict";

/* ================= LEXICONS ================= */
const AROUSAL={amazing:3,awesome:3,incredible:4,unbelievable:4,insane:4,crazy:3,wild:3,epic:3,legendary:3,unreal:3,mindblowing:5,spectacular:3,phenomenal:4,thrilling:3,stunning:3,breathtaking:4,explosive:4,huge:2,massive:3,shocking:4,shocked:3,stunned:3,speechless:4,whoa:3,wow:3,omg:4,suddenly:2,unexpected:3,twist:3,revealed:3,reveal:3,exposed:4,secret:3,hidden:2,forbidden:3,banned:3,hilarious:4,funny:2,ridiculous:3,absurd:3,laughing:2,joke:2,hysterical:4,fight:3,battle:3,war:3,destroy:4,destroyed:4,demolished:4,crushed:3,brutal:4,ruthless:3,furious:4,rage:4,angry:2,outraged:4,scandal:4,drama:3,betrayed:4,betrayal:4,lied:3,attacked:3,terrifying:4,horrifying:4,scary:3,nightmare:3,disaster:4,catastrophe:4,deadly:4,dangerous:3,panic:4,chaos:4,emergency:3,fatal:4,best:2,worst:3,greatest:3,biggest:2,impossible:3,never:2,ultimate:3,perfect:2,freaking:3,bonkers:3,nuts:2,genius:3,million:3,billion:4,jackpot:4,free:2,broke:3,bankrupt:4,winning:2,discovered:3,breakthrough:4,finally:2,proof:3,truth:3,fake:3,scam:4,hack:3,mistake:2,failed:2,success:2};
const HOOK_PHRASES=["you won't believe","you wont believe","listen to this","here's the secret","here's the thing","here's why","here's how","here is the thing","here is why","here is how","let me tell you","let me show you","what happened next","wait for it","watch this","check this out","the craziest part","the best part","the worst part","the biggest mistake","the number one","the truth is","the truth about","nobody talks about","no one talks about","nobody tells you","no one tells you","i can't believe","this changed everything","this changes everything","you need to know","you have to see","you have to hear","stop doing this","stop scrolling","i was wrong about","everyone gets this wrong","most people don't know","most people dont know","did you know","have you ever","imagine if","picture this","true story","fun fact","pay attention","this is important","this is huge","big announcement","i have a confession","story time","plot twist"];
const PUNCHLINE_MARKERS=["and that's why","and that is why","and that's how","turns out","it turns out","long story short","moral of the story","lesson learned","end of story","and the rest is history","boom","period","mic drop","that's it","that is it","and it worked","never again","the rest is history","case closed"];
const STOPWORDS=new Set(["a","an","the","and","or","but","if","then","than","so","of","to","in","on","at","by","for","with","about","as","is","am","are","was","were","be","been","being","do","does","did","doing","have","has","had","having","will","would","can","could","should","shall","may","might","must","i","me","my","mine","we","us","our","ours","you","your","yours","he","him","his","she","her","hers","it","its","they","them","their","theirs","this","that","these","those","what","which","who","whom","when","where","why","how","not","no","nor","only","all","any","both","each","few","more","most","other","some","up","down","out","off","over","under","into","from","again","once","also","well","like","get","got","go","going","went","one","two","really","thing","things","kind","sort","lot","bit","way","yeah","yes","okay","ok","um","uh","gonna","wanna","know","mean","right","just","now","here","there","very","quite"]);
const CONTEXT_STARTERS=new Set(["that","that's","this","these","those","it","it's","its","he","she","they","him","her","them","his","hers","their","which","so","because","but","and","also","then","therefore","however","anyway","anyways","meanwhile","instead","otherwise","plus","besides","still","yet","again"]);
const FEATURE_LABELS={audio_energy_mean:"sustained energy",audio_energy_peak:"energy spike",audio_burst:"burst moment",audio_payoff:"payoff moment",text_arousal:"high-arousal wording",text_question:"question",text_exclamation:"exclamation",text_hook_phrase:"hook phrase",text_punchline:"punchline closer",text_tfidf:"distinct keywords",text_repetition:"callback phrase",struct_position:"strong position",struct_speech_density:"dense speech",struct_self_contained:"self-contained",struct_complete_ending:"complete thought",text_hook_start:"opens with a hook",text_payoff_end:"ends on a payoff",duration_fit:"ideal length"};
const WEIGHTS={audio_energy_mean:1.0,audio_energy_peak:1.2,audio_burst:1.5,audio_payoff:1.3,text_arousal:1.6,text_question:0.8,text_exclamation:0.9,text_hook_phrase:1.8,text_punchline:1.0,text_tfidf:1.1,text_repetition:0.8,struct_position:0.5,struct_speech_density:0.9,struct_self_contained:1.0,struct_complete_ending:1.3,text_hook_start:2.0,text_payoff_end:1.2,duration_fit:1.0};

/* ================= STATE ================= */
const S={videoFile:null,videoURL:null,videoDuration:0,sentences:[],candidates:[],selected:[],dropped:new Set(),added:new Set(),audioEnergy:null,audioStats:null,opts:{target_s:60,count:5,aspect:"9:16",capTemplate:"bold",capPos:"bottom",capSize:"m",captions:true,fades:true,zoom:true,watermark:false,wmText:"",colorText:"#FFFF00",colorHl:"#FFFFFF"},exporting:false,cancelExport:false};
let ytReady=false,manualReady=false;

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
function buildSegCtrl(sel,vals,labels,key,def){const box=$(sel);box.innerHTML="";vals.forEach((v,i)=>{const b=document.createElement("button");b.type="button";b.textContent=labels?labels[i]:String(v);if(String(def??S.opts[key])===String(v))b.classList.add("sel");b.addEventListener("click",()=>{S.opts[key]=v;box.querySelectorAll("button").forEach(x=>x.classList.remove("sel"));b.classList.add("sel");});box.appendChild(b);});}
function bindDrop(zone,inp,cb){const z=$(zone),i=$(inp);z.addEventListener("click",()=>i.click());z.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();i.click();}});i.addEventListener("change",()=>{if(i.files[0])cb(i.files[0]);});["dragover","dragenter"].forEach(ev=>z.addEventListener(ev,e=>{e.preventDefault();z.classList.add("drag");}));["dragleave","drop"].forEach(ev=>z.addEventListener(ev,e=>{e.preventDefault();z.classList.remove("drag");}));z.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)cb(f);});}

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
  plP.onclick=()=>selPlan(true);
  plF.onclick=()=>selPlan(false);
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

/* ---- YouTube transcript fetch (best effort; falls back to copy-paste) ---- */
function ytId(input){const s=(input||"").trim();const m=s.match(/[?&]v=([\w-]{11})/)||s.match(/youtu\.be\/([\w-]{11})/)||s.match(/shorts\/([\w-]{11})/)||s.match(/embed\/([\w-]{11})/)||s.match(/transcript\?v=([\w-]{11})/);if(m)return m[1];if(/^[\w-]{11}$/.test(s))return s;return null;}
async function fetchViaProxies(target){const proxies=[u=>"https://api.allorigins.win/raw?url="+encodeURIComponent(u),u=>"https://corsproxy.io/?url="+encodeURIComponent(u)];
  for(const p of proxies){try{const ctl=new AbortController();const to=setTimeout(()=>ctl.abort(),20000);const res=await fetch(p(target),{signal:ctl.signal});clearTimeout(to);if(res.ok){const txt=await res.text();if(txt&&txt.length>500)return txt;}}catch(e){}}
  return null;}
function parseTranscriptHTML(html){const doc=new DOMParser().parseFromString(html,"text/html");
  const nodes=Array.from(doc.querySelectorAll("[data-start]"));const segs=[];
  for(const n of nodes){const st=parseFloat(n.getAttribute("data-start"));const tx=(n.textContent||"").replace(/\s+/g," ").trim();if(!isNaN(st)&&tx)segs.push({start:st,text:tx});}
  if(segs.length>3){segs.sort((a,b)=>a.start-b.start);const out=segs.map((s,i)=>({start:s.start,end:i+1<segs.length?Math.max(segs[i+1].start,s.start+0.5):s.start+4,text:s.text}));return{sents:out};}
  const cont=doc.querySelector("#transcript")||doc.querySelector(".transcript")||doc.querySelector("main")||doc.body;
  const raw=cont?cont.textContent.replace(/\s+/g," ").trim():"";
  if(raw.length>300)return{text:raw};
  return null;}
async function fetchYouTube(){const inp=$("#yt-url").value,st=$("#yt-status"),btn=$("#yt-fetch");
  const id=ytId(inp);
  if(!id){st.textContent="\u26a0 That doesn't look like a YouTube link. Paste the full video URL.";return false;}
  btn.disabled=true;
  st.textContent="\u23f3 Fetching the transcript\u2026";
  const target="https://youtubetotranscript.com/transcript?v="+id;
  let html=null;
  try{html=await fetchViaProxies(target);}catch(e){}
  btn.disabled=false;
  if(!html){st.innerHTML='Automatic fetch was blocked. <a class="link" href="'+target+'" target="_blank" rel="noopener">I opened the transcript page for you</a> \u2014 press \u201cCopy Transcript\u201d there, then paste it on the Manual side.';window.open(target,"_blank");return false;}
  const parsed=parseTranscriptHTML(html);
  if(!parsed){st.innerHTML='No transcript found \u2014 the video may have captions disabled. <a class="link" href="'+target+'" target="_blank" rel="noopener">Check it here</a>.';return false;}
  if(parsed.sents){S.sentences=parsed.sents;ytReady=true;
    const wc=parsed.sents.reduce((n,s)=>n+s.text.split(/\s+/).length,0);
    infoGrid("#tr-info",[["Source","YouTube (timed)"],["Words",String(wc)],["Sentences",String(parsed.sents.length)],["Cover",fmtTime(parsed.sents[0].start)+" \u2013 "+fmtTime(parsed.sents[parsed.sents.length-1].end)]]);
    st.textContent="\u2713 Transcript loaded with real timestamps \u2014 hit Use this!";return true;}
  handleTranscript(null,parsed.text);
  if(S.sentences.length){ytReady=true;st.textContent="\u2713 Transcript loaded \u2014 hit Use this!";return true;}
  return false;}

/* ================= STEP 3: OPTIONS ================= */
function initOpts(){
  buildSegCtrl("#opt-duration",[30,60,90,120,180],["30 s","1 min","1.5 min","2 min","3 min"],"target_s",60);
  buildSegCtrl("#opt-count",[3,5,7,10],["3","5","7","10"],"count",5);
  buildSegCtrl("#opt-aspect",["9:16","1:1","16:9"],["\ud83d\udcf1 9:16 vertical","\u25fb 1:1 square","\ud83d\udda5 16:9 wide"],"aspect","9:16");
  buildSegCtrl("#opt-cappos",["bottom","middle","top"],["\u2b07 Bottom","\u25cf Middle","\u2b06 Top"],"capPos","bottom");
  buildSegCtrl("#opt-capsize",["s","m","l"],["Small","Medium","Large"],"capSize","m");
  $$("#tpl-grid .tpl-card").forEach(c=>c.addEventListener("click",()=>{
    S.opts.capTemplate=c.dataset.tpl;
    S.opts.captions=c.dataset.tpl!=="none";
    $$("#tpl-grid .tpl-card").forEach(x=>x.classList.remove("sel"));
    c.classList.add("sel");
    const cc=$("#cap-custom-group");if(cc)cc.style.display=(c.dataset.tpl==="bold"||c.dataset.tpl==="clean")?"block":"none";
    const cs=$("#cap-settings");if(cs)cs.style.display=c.dataset.tpl==="none"?"none":"block";
  }));
}

/* ================= SCORING ENGINE ================= */
function tokenize(txt){return txt.toLowerCase().replace(/[^a-z0-9']/g," ").split(/\s+/).filter(Boolean).map(t=>t.replace(/[^a-z0-9]/g,"")).filter(t=>t&&!STOPWORDS.has(t));}
function buildCorpus(sents){const docs=sents.map(s=>tokenize(s.text));const df={};for(const doc of docs){const seen=new Set(doc);for(const t of seen)df[t]=(df[t]||0)+1;}const n=Math.max(docs.length,1);const idf={};for(const[t,c]of Object.entries(df))idf[t]=Math.log(n/(1+c))+1;const vals=Object.values(idf);const meanIdf=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:1;const grams={};for(const doc of docs)for(let k=0;k<doc.length-2;k++){const g=doc[k]+"|"+doc[k+1]+"|"+doc[k+2];grams[g]=(grams[g]||0)+1;}const callbacks=new Set(Object.entries(grams).filter(([,c])=>c>=3).map(([g])=>g));return{idf,meanIdf,callbacks};}
function buildCandidates(sents,targetS){const minLen=5,maxLen=targetS+Math.max(targetS*0.4,25);const cands=[];for(let i=0;i<sents.length;i++){for(let j=i;j<Math.min(i+12,sents.length);j++){const dur=sents[j].end-sents[i].start;if(dur>maxLen)break;if(dur>=minLen){const span=sents.slice(i,j+1),text=span.map(s=>s.text).join(" "),tokens=tokenize(text);cands.push({id:cands.length,sentLo:i,sentHi:j,start:sents[i].start,end:sents[j].end,duration:dur,text,tokens,sentences:span});}}}return cands;}
function extractFeatures(c,corpus,totalDur,ae,ideal,astats){const low=c.text.toLowerCase(),f={};
  f.text_arousal=c.tokens.reduce((s,t)=>s+(AROUSAL[t]||0),0)/Math.max(c.tokens.length,1);
  f.text_question=low.includes("?")?1:0;
  f.text_exclamation=Math.min((c.text.match(/!/g)||[]).length,3)/3;
  f.text_hook_phrase=HOOK_PHRASES.some(p=>low.includes(p))?1:0;
  f.text_punchline=PUNCHLINE_MARKERS.some(p=>low.includes(p))?1:0;
  f.text_tfidf=c.tokens.reduce((s,t)=>s+(corpus.idf[t]||corpus.meanIdf),0)/Math.max(c.tokens.length,1);
  let rep=0;for(let k=0;k<c.tokens.length-2;k++)if(corpus.callbacks.has(c.tokens[k]+"|"+c.tokens[k+1]+"|"+c.tokens[k+2]))rep++;f.text_repetition=Math.min(rep/Math.max(c.tokens.length,1),1);
  const firstS=c.sentences[0].text,lastS=c.sentences[c.sentences.length-1].text;
  const firstLow=firstS.toLowerCase();
  f.text_hook_start=HOOK_PHRASES.some(p=>firstLow.includes(p))||firstS.includes("?")?1:(tokenize(firstS).some(t=>(AROUSAL[t]||0)>=3)?0.6:0);
  const lastLow=lastS.toLowerCase();
  f.text_payoff_end=PUNCHLINE_MARKERS.some(p=>lastLow.includes(p))||/!\s*$/.test(lastS.trim())?1:0;
  f.struct_self_contained=CONTEXT_STARTERS.has(c.tokens[0]||"")?0:1;
  f.struct_complete_ending=/[.!?]\s*$/.test(c.text.trim())?1:0;
  f.struct_speech_density=Math.min(c.tokens.length/Math.max(c.duration,1)/3,1);
  const rp=c.start/Math.max(totalDur,1);f.struct_position=(rp<0.12||rp>0.82)?0.8:0;
  const sigma=Math.max(ideal*0.45,8);f.duration_fit=Math.exp(-((c.duration-ideal)**2)/(2*sigma*sigma));
  if(ae&&ae.length&&astats){const i0=Math.max(0,Math.floor(c.start)),i1=Math.min(ae.length-1,Math.floor(c.end));const sl=ae.slice(i0,i1+1);
    if(sl.length){const mean=sl.reduce((a,b)=>a+b,0)/sl.length,peak=arrMax(sl);f.audio_energy_mean=mean;f.audio_energy_peak=peak;
      let maxZ=0;for(const x of sl){const z=(x-astats.mean)/astats.std;if(z>maxZ)maxZ=z;}f.audio_burst=Math.min(Math.max(maxZ,0)/3,1);
      let pay=0;const quiet=astats.mean*0.5,loud=astats.mean*1.4;for(let k=1;k<sl.length;k++)if(sl[k-1]<quiet&&sl[k]>loud)pay++;f.audio_payoff=Math.min(pay/2,1);}
    else{f.audio_energy_mean=f.audio_energy_peak=f.audio_burst=f.audio_payoff=0;}}
  else{f.audio_energy_mean=f.audio_energy_peak=f.audio_burst=f.audio_payoff=0;}
  return f;}
function scoreAll(cands,corpus,totalDur,ae,ideal,astats){if(!cands.length)return[];const fns=Object.keys(WEIGHTS);for(const c of cands)c.rawF=extractFeatures(c,corpus,totalDur,ae,ideal,astats);for(const fn of fns){const vals=cands.map(c=>c.rawF[fn]||0),lo=arrMin(vals),hi=arrMax(vals);for(const c of cands){c.normF=c.normF||{};c.normF[fn]=hi>lo?((c.rawF[fn]||0)-lo)/(hi-lo):0;}}for(const c of cands){c.score=fns.reduce((s,fn)=>s+WEIGHTS[fn]*(c.normF[fn]||0),0);c.reasons=fns.filter(fn=>FEATURE_LABELS[fn]).map(fn=>({fn,v:WEIGHTS[fn]*(c.normF[fn]||0)})).sort((a,b)=>b.v-a.v).slice(0,3).filter(x=>x.v>0.15).map(x=>FEATURE_LABELS[x.fn]);}return cands.sort((a,b)=>b.score-a.score);}
function jaccard(a,b){let inter=0;for(const t of a)if(b.has(t))inter++;const uni=a.size+b.size-inter;return uni?inter/uni:0;}
function selectTop(scored,n){const sel=[];if(!scored.length)return sel;const maxScore=scored[0].score||1;const pool=scored.slice(0,400);for(const c of pool)c.tokenSet=c.tokenSet||new Set(c.tokens);
  while(sel.length<n){let best=null,bestVal=-Infinity;
    for(const c of pool){if(sel.includes(c))continue;if(sel.some(s=>!(c.sentHi<s.sentLo||s.sentHi<c.sentLo)))continue;
      let pen=0;for(const s of sel){pen=Math.max(pen,jaccard(c.tokenSet,s.tokenSet));const gap=Math.abs(c.start-s.start);if(gap<60)pen=Math.max(pen,(60-gap)/60*0.6);}
      const val=c.score-0.75*pen*maxScore;if(val>bestVal){bestVal=val;best=c;}}
    if(!best)break;sel.push(best);}
  return sel.sort((a,b)=>a.start-b.start);}
function refineBounds(seg){const ae=S.audioEnergy;let cs=seg.start,ce=seg.end;if(ae&&ae.length){let g=0;while(g++<4&&ce-cs>6){const i=Math.floor(cs);if(i>=0&&i<ae.length&&ae[i]<0.04)cs+=0.5;else break;}g=0;while(g++<4&&ce-cs>6){const i=Math.floor(ce);if(i>=0&&i<ae.length&&ae[i]<0.04)ce-=0.5;else break;}}cs=Math.max(0,cs-0.15);return{cs,ce};}
function ensureBounds(seg){if(seg.cs==null){const r=refineBounds(seg);seg.cs=r.cs;seg.ce=r.ce;}return seg;}

/* ================= AUDIO ANALYSIS ================= */
async function analyzeAudio(file){try{const ab=await file.arrayBuffer();const ctx=new(window.AudioContext||window.webkitAudioContext)();const audio=await ctx.decodeAudioData(ab);const data=audio.getChannelData(0),sr=audio.sampleRate,dur=audio.duration;const energy=[];for(let i=0;i<Math.ceil(dur);i++){const from=i*sr,to=Math.min(data.length,(i+1)*sr);let sum=0;for(let j=from;j<to;j++)sum+=data[j]*data[j];energy.push(Math.sqrt(sum/Math.max(to-from,1)));}const eMax=Math.max(arrMax(energy),0.0001);await ctx.close();return energy.map(v=>v/eMax);}catch(e){console.warn("Audio analysis failed:",e);return null;}}
