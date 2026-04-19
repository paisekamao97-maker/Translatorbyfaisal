'use strict';

/* ═══════════════════════════════════════════════
   ZabānLink — App Logic (app.js)
   Key is read from localStorage (saved by setup.html).
   If no key → redirect to setup.html.
   ═══════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

const historyEl       = $('history');
const livePanel       = $('livePanel');
const recLabel        = $('recLabel');
const livePreview     = $('livePreview');
const livePreviewText = $('livePreviewText');
const editPanel       = $('editPanel');
const editGoBtn       = $('editGoBtn');
const errbox          = $('errbox');
const sdot            = $('sdot');
const smsg            = $('smsg');
const micBtn          = $('micBtn');
const micLabel        = $('micLabel');
const installBanner   = $('installBanner');

let groqKey           = '';
let sourceLang        = 'auto';
let detectedLang      = null;
let mediaRecorder     = null;
let audioChunks       = [];
let isRecording       = false;
let lastBubbleId      = null;
let count             = 0;
let ttsTimer          = null;
let editSrcLang       = 'ur';
let editCurrentResult = { ur:'', roman:'', zh:'', en:'' };
let editDebounceTimer = null;
let editTranslating   = false;
let ttsVoices         = [];
let ttsUnlocked       = false;

const LANG_INFO = {
  ur: { name:'اردو',    nameEn:'Urdu',    dir:'rtl', cls:'ur' },
  zh: { name:'中文',    nameEn:'Chinese', dir:'ltr', cls:'zh' },
  en: { name:'English', nameEn:'English', dir:'ltr', cls:'en' },
};

const TTS_TARGET = { ur:'zh', zh:'ur', en:'zh' };

/* ─── INIT ─── */
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('vb_key');
  if (!saved || !saved.startsWith('gsk_')) {
    window.location.href = 'setup.html';
    return;
  }
  groqKey = saved;
  setLang(localStorage.getItem('vb_sourcelang') || 'auto', true);
  loadVoices();
  wireUI();
  /* iOS install banner */
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) && !window.MSStream;
  if (ios && !window.navigator.standalone && !localStorage.getItem('vb_hint')) {
    installBanner.classList.add('show');
    localStorage.setItem('vb_hint', '1');
    setTimeout(() => installBanner.classList.remove('show'), 8000);
  }
});

/* ─── UI WIRING ─── */
function wireUI() {
  $('gearBtn').addEventListener('click', resetKey);
  $('clearBtn').addEventListener('click', clearHistory);
  $('replayBtn').addEventListener('click', replayLast);
  micBtn.addEventListener('click', handleMic);
  $('editCancelBtn').addEventListener('click', cancelEdit);
  editGoBtn.addEventListener('click', confirmEdit);
  $('pill-auto').addEventListener('click', () => setLang('auto'));
  $('pill-ur').addEventListener('click',   () => setLang('ur'));
  $('pill-zh').addEventListener('click',   () => setLang('zh'));
  $('pill-en').addEventListener('click',   () => setLang('en'));
  $('tab-ur').addEventListener('click', () => switchEditSrcLang('ur'));
  $('tab-zh').addEventListener('click', () => switchEditSrcLang('zh'));
  $('tab-en').addEventListener('click', () => switchEditSrcLang('en'));
  wireEditFields();
  document.addEventListener('touchstart', unlockTTS, { once:true, passive:true });
  document.addEventListener('click', unlockTTS, { once:true });
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); handleMic(); }
  });
}

function resetKey() {
  if (!confirm('Change your Groq API key?')) return;
  localStorage.removeItem('vb_key');
  window.location.href = 'setup.html';
}

/* ─── STATUS / ERROR ─── */
function setSt(type, msg) { sdot.className = 'sdot' + (type ? ' ' + type : ''); smsg.textContent = msg; }
function showErr(msg, ms = 7000) { errbox.textContent = msg; errbox.classList.add('show'); setTimeout(() => errbox.classList.remove('show'), ms); }

/* ─── VOICES ─── */
function loadVoices() {
  if (!window.speechSynthesis) return;
  const store = () => { const v = window.speechSynthesis.getVoices(); if (v.length) ttsVoices = v; };
  store(); window.speechSynthesis.onvoiceschanged = store;
  [300,800,2000,4000].forEach(t => setTimeout(store, t));
}
function findUrduVoice() {
  if (!ttsVoices.length) return null;
  const v = ttsVoices.find(v=>v.lang==='ur-PK') || ttsVoices.find(v=>v.lang==='ur-IN') ||
            ttsVoices.find(v=>v.lang.startsWith('ur-')) || ttsVoices.find(v=>v.lang==='ur');
  return v ? { voice:v, isUrdu:true } : null;
}
function pickZhVoice() {
  if (!ttsVoices.length) return null;
  return ttsVoices.find(v=>v.lang==='zh-CN')||ttsVoices.find(v=>v.lang==='zh-TW')||
         ttsVoices.find(v=>v.lang==='zh-HK')||ttsVoices.find(v=>v.lang.startsWith('zh'))||null;
}
function pickEnVoice() {
  if (!ttsVoices.length) return null;
  return ttsVoices.find(v=>v.lang==='en-US')||ttsVoices.find(v=>v.lang==='en-GB')||
         ttsVoices.find(v=>v.lang.startsWith('en'))||null;
}

/* ─── LANGUAGE SELECTOR ─── */
function setLang(lang, silent=false) {
  sourceLang = lang;
  if (!silent) localStorage.setItem('vb_sourcelang', lang);
  ['auto','ur','zh','en'].forEach(l => {
    const p = $(l==='auto'?'pill-auto':'pill-'+l);
    if (p) { p.classList.toggle('active', l===lang); p.setAttribute('aria-checked', l===lang?'true':'false'); }
  });
  const hints = { auto:'ready — tap mic · auto-detect language', ur:'ready — speak اردو · tap mic',
                  zh:'ready — speak 中文 · tap mic', en:'ready — speak English · tap mic' };
  setSt('', hints[lang]||hints.auto);
}

/* ─── EDIT PANEL ─── */
function wireEditFields() {
  ['ur','zh','en'].forEach(lang => {
    const field = $('editField-'+lang); if (!field) return;
    field.addEventListener('focus', () => { if (lang!==editSrcLang) switchEditSrcLang(lang); });
    field.addEventListener('input', () => {
      if (lang!==editSrcLang) switchEditSrcLang(lang);
      editGoBtn.disabled = !field.value.trim();
      editCurrentResult[lang] = field.value;
      markOthersTranslating(lang); scheduleEditTranslation();
    });
  });
  const roField = $('editField-ro'); if (!roField) return;
  roField.addEventListener('focus', () => {
    roField.removeAttribute('readonly'); editSrcLang='ro';
    ['ur','zh','en'].forEach(l => {
      const t=$('tab-'+l); if(t) t.classList.remove('active');
      const st=$('srcTag-'+l); if(st) st.style.display='none';
    });
  });
  roField.addEventListener('input', () => {
    editSrcLang='ro'; editCurrentResult.roman=roField.value;
    editGoBtn.disabled=!roField.value.trim();
    markOthersTranslating('ro'); scheduleEditTranslation();
  });
}

function markOthersTranslating(srcLang) {
  ['ur','zh','en'].filter(k=>k!==srcLang).forEach(k => {
    editCurrentResult[k]='';
    const f=$('editField-'+k); if(f) f.classList.add('translating');
    const t=$('xlTag-'+k);    if(t) t.style.display='inline';
  });
  if (srcLang!=='ro') {
    const roF=$('editField-ro'); if(roF) roF.classList.add('translating');
    const roT=$('xlTag-ro');    if(roT) roT.style.display='inline';
  }
}

function scheduleEditTranslation() { clearTimeout(editDebounceTimer); setEditLiveDot(true); editDebounceTimer=setTimeout(runEditTranslation,650); }

async function runEditTranslation() {
  if (!groqKey) return;
  const actualSrc = editSrcLang==='ro'?'ur':editSrcLang;
  const srcField  = editSrcLang==='ro'?$('editField-ro'):$('editField-'+editSrcLang);
  const srcText   = (srcField?.value||'').trim();
  if (!srcText) { setEditLiveDot(false); return; }
  editTranslating=true; setEditLiveDot(true,'translating…');
  try {
    const result = await fetchAllTranslations(srcText, actualSrc);
    editCurrentResult = result;
    ['ur','zh','en'].forEach(lang => {
      if (lang===editSrcLang) return;
      const f=$('editField-'+lang); if(f){f.value=result[lang]||'';f.classList.remove('translating');}
      const t=$('xlTag-'+lang);    if(t) t.style.display='none';
    });
    const roF=$('editField-ro');
    if (roF&&editSrcLang!=='ro'){roF.value=result.roman||'';roF.classList.remove('translating');}
    const roT=$('xlTag-ro'); if(roT) roT.style.display='none';
    setEditLiveDot(false);
  } catch(e) { setEditLiveDot(false,'error — retry'); console.warn('[EditTranslation]',e.message); }
  editTranslating=false;
}

function setEditLiveDot(active,label='live translations') {
  const dot=$('editLiveDot'); const lbl=$('editLiveLabel');
  if(dot) dot.classList.toggle('translating',active);
  if(lbl) lbl.textContent=label;
}

function switchEditSrcLang(lang) {
  if (lang===editSrcLang) return;
  editSrcLang=lang;
  ['ur','zh','en'].forEach(l => {
    const t=$('tab-'+l);    if(t){t.classList.toggle('active',l===lang);t.setAttribute('aria-selected',l===lang?'true':'false');}
    const st=$('srcTag-'+l);if(st) st.style.display=l===lang?'inline':'none';
    const f=$('editField-'+l);if(f) f.removeAttribute('readonly');
  });
  const roF=$('editField-ro'); if(roF) roF.setAttribute('readonly','');
  const f=$('editField-'+lang);
  if (f&&f.value.trim()){editCurrentResult[lang]=f.value;markOthersTranslating(lang);scheduleEditTranslation();}
}

function showEditPanel(transcript, srcLang) {
  editSrcLang=srcLang||'ur';
  editCurrentResult={ur:'',roman:'',zh:'',en:''};
  ['ur','zh','en'].forEach(l=>{
    const f=$('editField-'+l);
    if(f){f.value=l===editSrcLang?transcript:'';f.classList.remove('translating');f.removeAttribute('readonly');}
    const st=$('srcTag-'+l);  if(st) st.style.display=l===editSrcLang?'inline':'none';
    const t=$('tab-'+l);      if(t){t.classList.toggle('active',l===editSrcLang);t.setAttribute('aria-selected',l===editSrcLang?'true':'false');}
    const xt=$('xlTag-'+l);   if(xt) xt.style.display='none';
  });
  const roF=$('editField-ro');
  if(roF){roF.value='';roF.setAttribute('readonly','');roF.classList.remove('translating');}
  editCurrentResult[editSrcLang]=transcript;
  editGoBtn.disabled=!transcript.trim();
  editPanel.classList.add('show'); setEditMode(true);
  setSt('proc','tap any field to edit · translations update live');
  setTimeout(()=>{
    const f=$('editField-'+editSrcLang);
    if(f){f.focus();const l=f.value.length;try{f.setSelectionRange(l,l);}catch(_){}}
  },250);
  scheduleEditTranslation();
}

function hideEditPanel(){editPanel.classList.remove('show');setEditMode(false);clearTimeout(editDebounceTimer);}

function cancelEdit(){
  hideEditPanel();hideLivePanel();
  editCurrentResult={ur:'',roman:'',zh:'',en:''};
  setSt('','ready — tap mic · speak in any language');
}

async function confirmEdit(){
  const srcField=$('editField-'+editSrcLang); if(!srcField) return;
  const srcText=srcField.value.trim();        if(!srcText) return;
  if(editTranslating){setSt('proc','finishing translation…');await sleep(900);}
  let result=editCurrentResult;
  const needsTranslation=!result.ur||!result.zh||!result.en;
  hideEditPanel();
  micBtn.classList.add('proc'); micLabel.textContent='translating…';
  setSt('proc','translating…');
  try {
    if(needsTranslation) result=await fetchAllTranslations(srcText,editSrcLang==='ro'?'ur':editSrcLang);
    micBtn.classList.remove('proc'); micLabel.textContent='tap to speak';
    const actualSrc=editSrcLang==='ro'?'ur':editSrcLang;
    const ttsLang=TTS_TARGET[actualSrc]||'zh';
    setSt('ok','speaking…');
    const id=addBubble(result,actualSrc);
    lastBubbleId=id;
    speakForLang(id,ttsLang,result,()=>setSt('','ready — tap mic · speak in any language'));
  } catch(e){
    micBtn.classList.remove('proc'); micLabel.textContent='tap to speak';
    showErr(e.message||'Translation error — try again');
    setSt('','ready — tap mic · speak in any language');
  }
}

function setEditMode(active){
  $('clearBtn').classList.toggle('hidden',active);
  if(active){micBtn.classList.add('edit-mode');micLabel.textContent='confirm →';}
  else{micBtn.classList.remove('edit-mode');micLabel.textContent='tap to speak';}
}

/* ─── LIVE PANEL ─── */
function showLivePanel(isRec){
  livePanel.classList.add('show'); livePreview.classList.remove('show');
  livePreviewText.textContent=''; $('detectedBadge').style.display='none';
  const langName=sourceLang==='auto'?'any language':(LANG_INFO[sourceLang]?.nameEn||sourceLang);
  recLabel.textContent=isRec?('listening — '+langName):'transcribing…';
}
function hideLivePanel(){livePanel.classList.remove('show');}

/* ─── TRANSLATION ENGINE ─── */
async function fetchAllTranslations(text,srcLang,attempt=1){
  if(!groqKey) throw new Error('No API key — tap ⚙ to set one.');
  const srcInfo=LANG_INFO[srcLang]||{nameEn:'Urdu'};
  const instrMap={
    ur:[`"ur": COPY the original Urdu text EXACTLY`,`"roman": Urdu phonetically in Latin (e.g. "Aap kaisy hain?")`,`"zh": TRANSLATE to Simplified Chinese — must contain CJK characters`,`"en": TRANSLATE to English`],
    zh:[`"ur": TRANSLATE to Urdu. MUST use Arabic/Nastaliq script. NEVER use Roman or Devanagari. Example: 你好 → آپ کیسے ہیں`,`"roman": Urdu translation phonetically in Latin (e.g. "Aap kaisy hain?")`,`"zh": COPY the original Chinese text EXACTLY`,`"en": TRANSLATE to English`],
    en:[`"ur": TRANSLATE to Urdu. MUST use Arabic/Nastaliq script. NEVER use Roman. Example: Hello → ہیلو`,`"roman": Urdu translation phonetically in Latin`,`"zh": TRANSLATE to Simplified Chinese — must contain CJK characters`,`"en": COPY the original English text EXACTLY`],
  };
  const instructions=(instrMap[srcLang]||instrMap.en).join('\n');
  const prompt=`Translate from ${srcInfo.nameEn}.\n\nSource: "${text}"\n\nReturn ONLY valid JSON with exactly these 4 keys:\n{\n${instructions}\n}\n\nSTRICT RULES:\n- "ur" MUST contain Arabic script chars (ا ب پ ت ث ج چ ح etc). Never Latin.\n- "zh" MUST contain CJK chars (一 你 好 etc). Never Pinyin.\n- "roman" MUST be Latin letters only.\n- ALL fields must be non-empty.\nOutput ONLY the JSON:`;
  let resp;
  try{
    resp=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',headers:{'Authorization':'Bearer '+groqKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:700,temperature:0.0,
        messages:[{role:'system',content:'You are a multilingual translator. Output ONLY valid JSON. "ur" key ALWAYS uses Arabic/Nastaliq script. "zh" key ALWAYS uses Chinese characters. Never use pinyin or roman for those fields.'},{role:'user',content:prompt}]})
    });
  }catch(e){throw new Error('Network error — check connection.');}
  if(resp.status===401) throw new Error('Invalid API key — tap ⚙ to update.');
  if(resp.status===429) throw new Error('Rate limit — wait a moment and retry.');
  if(!resp.ok){let m='API error '+resp.status;try{const j=await resp.json();m=j?.error?.message||m;}catch(_){}throw new Error(m);}
  const data=await resp.json();
  let raw=(data.choices?.[0]?.message?.content||'').trim();
  raw=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const jMatch=raw.match(/\{[\s\S]*\}/);
  if(!jMatch){if(attempt<4) return fetchAllTranslations(text,srcLang,attempt+1);throw new Error('Translation failed — try again.');}
  let parsed;
  try{parsed=JSON.parse(jMatch[0]);}catch(e){if(attempt<4) return fetchAllTranslations(text,srcLang,attempt+1);throw new Error('Parse error — try again.');}
  const missing=['ur','roman','zh','en'].filter(k=>!parsed[k]||!String(parsed[k]).trim());
  if(missing.length){if(attempt<4) return fetchAllTranslations(text,srcLang,attempt+1);throw new Error('Incomplete translation — try again.');}
  if(!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(parsed.zh)){if(attempt<4) return fetchAllTranslations(text,srcLang,attempt+1);throw new Error('Chinese translation issue — try again.');}
  if(!/[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]/.test(parsed.ur)){
    console.warn('[Translation] ur has no Arabic script, attempt',attempt);
    if(attempt<4) return fixUrduScript(text,srcLang,parsed,attempt);
    throw new Error('Urdu translation issue — try again.');
  }
  return parsed;
}

async function fixUrduScript(originalText,srcLang,partialResult,attempt){
  try{
    const resp=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',headers:{'Authorization':'Bearer '+groqKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:200,temperature:0.0,
        messages:[{role:'system',content:'You write Urdu ONLY in Arabic/Nastaliq script. Never use Roman or Devanagari.'},{role:'user',content:`Write this in Urdu using Arabic Nastaliq script:\n"${originalText}"\n\nReturn ONLY JSON: {"ur":"اردو یہاں","roman":"roman here"}\nNo other text.`}]})
    });
    const data=await resp.json();
    let raw=(data.choices?.[0]?.message?.content||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    const jm=raw.match(/\{[\s\S]*\}/);
    if(jm){const fix=JSON.parse(jm[0]);if(fix.ur&&/[\u0600-\u06ff]/.test(fix.ur)){partialResult.ur=fix.ur;if(fix.roman)partialResult.roman=fix.roman;return partialResult;}}
  }catch(_){}
  return fetchAllTranslations(originalText,srcLang,attempt+1);
}

/* ─── WHISPER LANGUAGE MAPPING ─── */
function mapWhisperLang(wLang){
  if(!wLang) return null;
  const l=wLang.toLowerCase().trim();
  if(l==='zh'||l.startsWith('zh-')||['cmn','yue','wuu','hak','nan'].includes(l)) return 'zh';
  if(l==='ur'||l==='urdu') return 'ur';
  if(l==='hi'||l==='hindi'||l==='hin') return '__hindi__';
  if(l==='en'||l.startsWith('en-')) return 'en';
  if(['pa','panjabi','punjabi'].includes(l)) return 'ur';
  return null;
}

/* ─── MICROPHONE ─── */
async function handleMic(){
  if(editPanel.classList.contains('show')){confirmEdit();return;}
  if(isRecording){stopRec();return;}
  if(!groqKey){showErr('No API key — tap ⚙ to update.');return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,sampleRate:16000}});
    startRec(stream);
  }catch(e){showErr('Microphone access denied — allow mic in browser settings.');}
}

function startRec(stream){
  audioChunks=[];
  const types=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/ogg',''];
  const mime=types.find(t=>!t||MediaRecorder.isTypeSupported(t))||'';
  try{mediaRecorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});}
  catch{mediaRecorder=new MediaRecorder(stream);}
  mediaRecorder.ondataavailable=e=>{if(e.data&&e.data.size>0)audioChunks.push(e.data);};
  mediaRecorder.onstop=processAudio;
  mediaRecorder.start(200);
  isRecording=true;
  micBtn.classList.add('rec'); micLabel.textContent='tap to stop'; micBtn.setAttribute('aria-pressed','true');
  showLivePanel(true);
  setSt('rec','recording — '+(sourceLang==='auto'?'any language':(LANG_INFO[sourceLang]?.nameEn||sourceLang)));
}

function stopRec(){
  if(!mediaRecorder||mediaRecorder.state==='inactive') return;
  isRecording=false;
  mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t=>t.stop());
  micBtn.classList.remove('rec'); micBtn.classList.add('proc');
  micLabel.textContent='transcribing…'; micBtn.setAttribute('aria-pressed','false');
  recLabel.textContent='transcribing…'; setSt('proc','transcribing…');
}

async function processAudio(){
  micBtn.classList.remove('proc'); micLabel.textContent='tap to speak';
  if(!audioChunks.length){hideLivePanel();setSt('','ready');return;}
  const mime=mediaRecorder.mimeType||'audio/webm';
  const ext=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm';
  const blob=new Blob(audioChunks,{type:mime});
  if(blob.size<1500){hideLivePanel();showErr('Audio too short — hold the button longer and speak clearly.');setSt('','ready');return;}
  try{
    setSt('proc','transcribing with Whisper…');
    const form1=new FormData();
    form1.append('file',blob,'audio.'+ext);form1.append('model','whisper-large-v3');
    if(sourceLang!=='auto'){const wl={ur:'ur',zh:'zh',en:'en'}[sourceLang];if(wl)form1.append('language',wl);}
    form1.append('response_format','verbose_json');
    const r1=await groqAudioFetch(form1);
    if(!r1.ok){const errData=await safeJson(r1);hideLivePanel();showErr(errData?.error?.message||'Whisper error '+r1.status);setSt('','ready');return;}
    const d1=await r1.json();
    let transcript=(d1.text||'').trim();
    if(!transcript){hideLivePanel();showErr('No speech detected — try speaking closer to the mic.');setSt('','ready');return;}
    let actualLang=sourceLang==='auto'?null:sourceLang;
    if(sourceLang==='auto'){
      const mapped=mapWhisperLang(d1.language||'');
      if(mapped==='__hindi__'){
        setSt('proc','Urdu/Hindi detected — converting script…');
        const form2=new FormData();form2.append('file',blob,'audio.'+ext);form2.append('model','whisper-large-v3');form2.append('language','ur');form2.append('response_format','verbose_json');
        try{const r2=await groqAudioFetch(form2);if(r2.ok){const d2=await r2.json();const t2=(d2.text||'').trim();if(t2)transcript=t2;}}catch(_){}
        actualLang='ur';
      }else if(mapped){actualLang=mapped;}
      else{
        setSt('proc','identifying language…');actualLang=await detectLangViaLLM(transcript);
        if(actualLang==='ur'&&!/[\u0600-\u06ff]/.test(transcript)){
          const form3=new FormData();form3.append('file',blob,'audio.'+ext);form3.append('model','whisper-large-v3');form3.append('language','ur');form3.append('response_format','verbose_json');
          try{const r3=await groqAudioFetch(form3);if(r3.ok){const d3=await r3.json();const t3=(d3.text||'').trim();if(t3)transcript=t3;}}catch(_){}
        }
      }
      detectedLang=actualLang;
      $('detectedLangName').textContent=LANG_INFO[actualLang]?.nameEn||actualLang;
      $('detectedBadge').style.display='inline-flex';
    }else{actualLang=sourceLang;detectedLang=sourceLang;}
    livePreviewText.className='live-preview-text';
    if(actualLang==='ur') livePreviewText.classList.add('ur');
    if(actualLang==='zh') livePreviewText.classList.add('zh');
    livePreviewText.textContent=transcript;
    livePreview.classList.add('show');
    recLabel.textContent='transcribed ✓ — review below';
    await sleep(300); hideLivePanel(); showEditPanel(transcript,actualLang);
  }catch(e){
    hideLivePanel();showErr('Error: '+(e.message||'check connection and try again'));
    setSt('','ready — tap mic · speak in any language');
  }
}

async function groqAudioFetch(formData){return fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+groqKey},body:formData});}
async function safeJson(resp){try{return await resp.json();}catch(_){return null;}}

async function detectLangViaLLM(text){
  try{
    const resp=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+groqKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:5,temperature:0,messages:[{role:'user',content:`Identify language. Reply ONLY "ur", "zh", or "en".\nText: "${text.slice(0,300)}"`}]})});
    const d=await resp.json();
    const ans=(d.choices?.[0]?.message?.content||'').trim().toLowerCase().replace(/[^a-z]/g,'');
    if(ans==='zh'||ans.includes('chinese')) return 'zh';
    if(ans==='ur'||ans.includes('urdu')||ans.includes('hindi')) return 'ur';
    return 'en';
  }catch(_){return 'ur';}
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

/* ─── TTS ─── */
function unlockTTS(){
  if(ttsUnlocked||!window.speechSynthesis) return;
  try{const u=new SpeechSynthesisUtterance('');u.volume=0;window.speechSynthesis.speak(u);ttsUnlocked=true;}catch(_){}
}

function speakForLang(id,ttsLang,result,onEnd){
  if(window.speechSynthesis) ttsVoices=window.speechSynthesis.getVoices();
  if(!window.speechSynthesis){onEnd&&onEnd();return;}
  window.speechSynthesis.cancel(); clearTimeout(ttsTimer); clearHighlight(id);
  const card=$('bubble-'+id); const spkEl=$('spk-'+id+'-'+ttsLang);
  card&&card.classList.add('speaking'); spkEl&&spkEl.classList.add('on');
  function cleanup(){clearTimeout(ttsTimer);card&&card.classList.remove('speaking');spkEl&&spkEl.classList.remove('on');onEnd&&onEnd();}
  if(ttsLang==='ur'){
    const found=findUrduVoice();
    if(!found){setSt('ok','🔊 no Urdu voice — playing English');speakText(result.en,'en-US',pickEnVoice(),0.88,cleanup);}
    else{setSt('ok','🔊 speaking اردو…');speakText(result.ur,found.voice.lang,found.voice,0.78,cleanup);}
  }else if(ttsLang==='zh'){
    const zhVoice=pickZhVoice(); const zhText=result.zh||''; const chars=[...zhText].length;
    setSt('ok','🔊 speaking 中文…');
    const u=makeSpeechUtterance(zhText,zhVoice?zhVoice.lang:'zh-CN',zhVoice,0.82);
    let started=false;
    const stall=setTimeout(()=>{if(!started){window.speechSynthesis.cancel();cleanup();}},3500);
    u.onstart=()=>{started=true;clearTimeout(stall);animateChars(id,chars,Math.max(180,320/Math.max(0.82,0.5)));};
    u.onend=()=>{clearTimeout(stall);litAll(id,chars);setTimeout(cleanup,300);};
    u.onerror=e=>{clearTimeout(stall);console.warn('[TTS zh]',e.error);cleanup();};
    if(window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.speak(u);
  }else{setSt('ok','🔊 speaking English…');speakText(result.en,'en-US',pickEnVoice(),0.88,cleanup);}
}

function makeSpeechUtterance(text,lang,voice,rate){const u=new SpeechSynthesisUtterance(text);u.lang=lang;if(voice)u.voice=voice;u.rate=rate;u.pitch=1.0;return u;}

function speakText(text,lang,voice,rate,onEnd){
  const u=makeSpeechUtterance(text,lang,voice,rate);
  let called=false; const done=()=>{if(!called){called=true;onEnd&&onEnd();}};
  let started=false;
  const stall=setTimeout(()=>{if(!started){window.speechSynthesis.cancel();done();}},3500);
  u.onstart=()=>{started=true;clearTimeout(stall);};u.onend=()=>{clearTimeout(stall);done();};
  u.onerror=e=>{clearTimeout(stall);console.warn('[TTS]',e.error);done();};
  if(window.speechSynthesis.paused) window.speechSynthesis.resume();
  window.speechSynthesis.speak(u);
}

/* ─── CHAT BUBBLES ─── */
function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escAttr(s){return(s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

function addBubble(result,srcLang){
  const es=$('emptyState');if(es)es.remove();
  const id='b'+(++count);
  const time=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const allJson=escAttr(JSON.stringify(result));
  const isSelfRight=(srcLang==='ur'||srcLang==='en');
  const bubbleClass=isSelfRight?'bubble-self-ur':'bubble-self-zh';
  const rowClass=isSelfRight?'self':'other';
  const avatarClass=srcLang==='ur'?'avatar-ur':srcLang==='zh'?'avatar-zh':'avatar-en';
  const senderLabel=srcLang==='ur'?'اردو · آپ':srcLang==='zh'?'中文 · 你':'English · you';
  const senderCls=srcLang==='ur'?'ur-sender':srcLang==='zh'?'zh-sender':'en-sender';
  const zhSpans=[...result.zh].map((ch,i)=>`<span class="zh-char" id="${id}-c${i}">${escHtml(ch)}</span>`).join('');
  const ttsLang=TTS_TARGET[srcLang]||'zh';
  const html=`
<div class="chat-row ${rowClass}">
  <div class="chat-bubble ${bubbleClass}" id="bubble-${id}">
    <div data-src-text="${escAttr(srcLang==='ur'?result.ur:srcLang==='zh'?result.zh:result.en)}" data-src-lang="${escAttr(srcLang)}" data-all="${allJson}" style="display:none"></div>
    <div class="bubble-sender ${senderCls}">${escHtml(senderLabel)}</div>
    <span class="b-lang-label ur">اردو</span>
    <span class="b-ur" id="urt-${id}">${escHtml(result.ur)}</span>
    <span class="b-ro">${escHtml(result.roman||'')}</span>
    <div class="bubble-divider"></div>
    <span class="b-lang-label zh">中文</span>
    <span class="b-zh" id="zht-${id}">${zhSpans}</span>
    <div class="bubble-divider"></div>
    <span class="b-lang-label en">english</span>
    <span class="b-en" id="ent-${id}">${escHtml(result.en)}</span>
    <div class="bubble-foot">
      <div class="icon-btn spk-btn" id="spk-${id}-${ttsLang}" title="replay" onclick="replayBubble('${id}','${escAttr(srcLang)}')">🔊</div>
      <div class="icon-btn edt-btn" title="edit" onclick="editBubble('${id}')">✏️</div>
      <span class="bubble-time">${time}</span>
    </div>
  </div>
  <div class="chat-avatar ${avatarClass}">🗣</div>
</div>`;
  const group=document.createElement('div');group.className='chat-group';group.id=id;
  group.innerHTML=html;historyEl.appendChild(group);historyEl.scrollTop=historyEl.scrollHeight;
  return id;
}

function replayBubble(id,srcLang){
  const dataEl=document.querySelector('#'+id+' [data-all]');
  let result={ur:'',roman:'',zh:'',en:''};
  if(dataEl){try{result=JSON.parse(dataEl.getAttribute('data-all'));}catch(_){}}
  const ttsLang=TTS_TARGET[srcLang||'ur']||'zh';
  speakForLang(id,ttsLang,result,()=>setSt('','ready — tap mic · speak in any language'));
}

function editBubble(id){
  const dataEl=document.querySelector('#'+id+' [data-src-text]');if(!dataEl) return;
  const text=dataEl.getAttribute('data-src-text');
  const lang=dataEl.getAttribute('data-src-lang');
  const allData=dataEl.getAttribute('data-all');
  const bEl=$(id);if(bEl)bEl.remove();
  if(!historyEl.querySelector('.chat-group')) historyEl.innerHTML=emptyHTML();
  if(lastBubbleId===id) lastBubbleId=null;
  showEditPanel(text,lang);
  if(allData){try{const r=JSON.parse(allData);editCurrentResult=r;['ur','zh','en'].forEach(l=>{const f=$('editField-'+l);if(f&&l!==lang)f.value=r[l]||'';});const roF=$('editField-ro');if(roF)roF.value=r.roman||'';}catch(_){}}
}

function emptyHTML(){
  return `<div class="empty" id="emptyState" role="status">
    <div class="empty-orb" aria-hidden="true">🎙</div>
    <div class="empty-title" lang="mixed">بولیں · 说吧</div>
    <div class="empty-hint">
      person 1 speaks <span lang="ur" style="color:var(--ur);font-family:'Noto Nastaliq Urdu',serif">اردو</span> — bubbles on right<br>
      person 2 speaks <span lang="zh" style="color:var(--zh);font-family:'Noto Sans SC',sans-serif">中文</span> — bubbles on left<br>
      all 4 translations in one card · tap 🔊 to play
    </div>
  </div>`;
}

/* ─── TTS ANIMATION ─── */
function animateChars(id,total,mpc){let i=0;function next(){if(i>0)unlit(id,i-1);if(i<total){lit(id,i);i++;ttsTimer=setTimeout(next,mpc);}}next();}
function lit(id,i){const e=$(id+'-c'+i);if(e)e.classList.add('lit');}
function unlit(id,i){const e=$(id+'-c'+i);if(e)e.classList.remove('lit');}
function litAll(id,t){for(let i=0;i<t;i++)lit(id,i);}
function clearHighlight(id){clearTimeout(ttsTimer);const group=$(id);if(!group)return;group.querySelectorAll('.zh-char').forEach(c=>c.classList.remove('lit'));}

/* ─── CONTROLS ─── */
function replayLast(){
  if(!lastBubbleId) return;
  const dataEl=document.querySelector('#'+lastBubbleId+' [data-src-lang]');
  const sl=dataEl?dataEl.getAttribute('data-src-lang'):'ur';
  replayBubble(lastBubbleId,sl);
}

function clearHistory(){
  window.speechSynthesis&&window.speechSynthesis.cancel();clearTimeout(ttsTimer);
  hideEditPanel();hideLivePanel();
  lastBubbleId=null;count=0;editCurrentResult={ur:'',roman:'',zh:'',en:''};detectedLang=null;
  historyEl.innerHTML=emptyHTML();setSt('','ready — tap mic · speak in any language');
}

if(window.speechSynthesis) loadVoices();
