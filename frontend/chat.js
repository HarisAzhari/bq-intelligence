// Sheet conversations: one per project and physical page. The server copy is
// authoritative; browser storage keeps older chats until they are imported.
const CHAT_STORAGE='atlas-sheet-chats-v1';
const sheetChats=new Map();
try{for(const [key,value] of JSON.parse(localStorage.getItem(CHAT_STORAGE)||'[]')){
 if(value && Array.isArray(value.turns))sheetChats.set(key,{...value,busy:false,error:'',failed:'',pending:null});
}}catch{}
function saveChats(){try{localStorage.setItem(CHAT_STORAGE,JSON.stringify([...sheetChats]));}catch{toast('Browser storage is full or unavailable. This chat will last until reload.')}renderChatHistory()}
function chatKey(){return project.id+':'+currentPage}
function chatState(key){if(!sheetChats.has(key))sheetChats.set(key,{turns:[],draft:'',busy:false,error:''});return sheetChats.get(key)}

const svg=d=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON={
 spark:svg('<path d="M11 3.5c.5 4.4 2.3 6.2 6.7 6.7-4.4.5-6.2 2.3-6.7 6.7-.5-4.4-2.3-6.2-6.7-6.7 4.4-.5 6.2-2.3 6.7-6.7Z"/><path d="M18.5 15c.2 1.7.9 2.4 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.1 2.3-.8 2.5-2.5Z"/>'),
 send:svg('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>'),
 arrow:svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
 back:svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
 check:svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
 alert:svg('<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4M12 17h.01"/>'),
 chevron:svg('<path d="m6 9 6 6 6-6"/>'),
 target:svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
 help:svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8M12 17h.01"/>'),
 close:svg('<path d="M6 6l12 12M18 6 6 18"/>'),
 plus:svg('<path d="M12 5v14M5 12h14"/>'),
 minus:svg('<path d="M5 12h14"/>'),
 external:svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
 layout:svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 10h17M10 10v10.5"/>'),
 ruler:svg('<path d="M3 16.5 16.5 3 21 7.5 7.5 21 3 16.5Z"/><path d="m7 12.5 2 2M10 9.5l2 2M13 6.5l2 2"/>'),
 pencil:svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
 notes:svg('<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/>'),
};

function projectChats(){
 if(!project)return [];
 return [...sheetChats].filter(([key,v])=>key.startsWith(project.id+':')&&v.turns.length)
  .sort((a,b)=>(b[1].updated||0)-(a[1].updated||0))
  .map(([key,state])=>({page:Number(key.split(':').pop()),state}))
  .filter(c=>project.pages[c.page-1]);
}
function renderChatHistory(){
 const nav=document.querySelector('[data-nav="chat"]');if(!nav)return;
 let list=$('#chatHistory');if(!list){list=document.createElement('div');list.id='chatHistory';nav.after(list)}
 list.innerHTML=projectChats().map(({page,state})=>{const sheet=project.pages[page-1];return `<button data-chat-page="${page}" title="${esc(sheet.title)}"><span class="history-page">P${page}</span><span class="history-text"><strong>${esc(sheet.title)}</strong><small>${esc(state.turns.find(t=>t.role==='user')?.content||'Conversation')}</small></span></button>`}).join('');
 list.querySelectorAll('[data-chat-page]').forEach(b=>b.onclick=()=>openAskStudio(Number(b.dataset.chatPage)));
}
// Shown above the drawing list on the Ask drawings page.
function recentChatsSection(){
 const chats=projectChats();
 if(!chats.length)return `<div class="ask-start"><span class="ask-start-icon">${ICON.spark}</span><div><h3>How to ask about a drawing</h3><ol><li>Find the drawing below. You can search by name or number.</li><li>Click it to open its question page.</li><li>Ask in your own words. The answer points to the right place on the drawing.</li></ol></div></div>`;
 return `<section class="recent-chats"><div class="section-title"><div><h3>Continue a conversation</h3><p>Pick up where you left off.</p></div></div><div class="recent-grid">${chats.slice(0,6).map(({page,state})=>{
  const s=project.pages[page-1],asked=state.turns.filter(t=>t.role==='user');
  return `<button class="recent-chat" data-page="${page}"><span class="recent-thumb"><img src="${imageUrl(page,560)}" alt="" loading="lazy"></span><span class="recent-body"><span class="recent-meta">Page ${page} · ${asked.length} question${asked.length===1?'':'s'}</span><strong>${esc(s.title)}</strong><span class="recent-q">“${esc(asked.at(-1)?.content||'')}”</span><span class="recent-go">Continue →</span></span></button>`;
 }).join('')}</div></section><div class="section-title"><div><h3>Or choose a drawing</h3><p>Open any sheet to ask a new question.</p></div></div>`;
}

// Named apart from ingestion.js's usageHtml, which formats generation metrics.
function chatUsageHtml(u={}){
 const number=k=>Number.isFinite(u[k])?Number(u[k]).toLocaleString():'Unavailable';
 const cell=(label,value)=>`<div><dt>${label}</dt><dd>${value}</dd></div>`;
 return `<dl class="usage-grid">${cell('Cost',Number.isFinite(u.cost)?'$'+u.cost.toFixed(5):'Unavailable')}${cell('Input tokens',number('prompt_tokens'))}${cell('Output tokens',number('completion_tokens'))}${cell('Total tokens',number('total_tokens'))}</dl>`;
}
function totalUsage(turns){
 const replies=turns.filter(t=>t.role==='assistant'),sum={};
 for(const k of ['prompt_tokens','completion_tokens','total_tokens','cost'])if(replies.length&&replies.every(t=>Number.isFinite(t.usage?.[k])))sum[k]=replies.reduce((n,t)=>n+t.usage[k],0);
 return sum;
}

// Highlight regions, shared by the sheet viewer and the question page.
let showHighlights=true, regionObserver=null;
const HIGHLIGHT_COLORS=[['#e9a126','Amber'],['#3a86ff','Blue'],['#a855f7','Purple'],['#e34d72','Pink'],['#199c76','Green'],['#f05a28','Orange']];
const replyColors=HIGHLIGHT_COLORS.slice(0,5).map(([c])=>c);
function replyColor(state,i){const c=state.colors?.[i];return /^#[0-9a-f]{6}$/i.test(c||"")?c:replyColors[Math.floor(i/2)%replyColors.length]}
const answerNumber=i=>Math.floor(i/2)+1;
const listWords=a=>a.length<2?a.join(''):a.slice(0,-1).join(', ')+' and '+a.at(-1);
const KIND_LABELS={ai:'Approximate area',text:'Matched text',user:'Confirmed area'};
const kindLabel=s=>KIND_LABELS[s.kind]||KIND_LABELS.text;
const hasBox=s=>Array.isArray(s?.box)&&s.box.length===4&&s.box.every(Number.isFinite);
const regionKey=box=>box.map(v=>Math.round(v*1e4)).join('-');
function highlightOwner(state,index){
 const seen=new Set();while(Number.isInteger(state.turns[index]?.highlight_ref)&&!seen.has(index)){
 seen.add(index);const next=state.turns[index].highlight_ref;if(next<0||next>=index)break;index=next;
 }return index;
}
function visibleRegions(state){
 const seen=new Set(),regions=[];
 state.turns.forEach((turn,i)=>{
 if(state.selected!=null&&!state.selected.map(n=>highlightOwner(state,n)).includes(highlightOwner(state,i)))return;
 const owner=highlightOwner(state,i);
 for(const source of state.turns[owner]?.sources||[]){
 if(!hasBox(source))continue;
 const key=JSON.stringify([source.page,...source.box]);if(seen.has(key))continue;
 seen.add(key);regions.push({source,owner});
 }
 });return regions;
}
const boxStyle=([x0,y0,x1,y1])=>`left:${x0*100}%;top:${y0*100}%;width:${(x1-x0)*100}%;height:${(y1-y0)*100}%`;
function regionsHtml(state){
 if(!showHighlights)return '';
 return visibleRegions(state).map(({source,owner})=>{
  const [x0,y0]=source.box,classes=['region',source.kind==='ai'&&'is-approx',x0>.6&&'label-end',y0<.05&&'label-below'].filter(Boolean).join(' ');
  return `<div class="${classes}" data-region="${regionKey(source.box)}" style="${boxStyle(source.box)};--c:${replyColor(state,owner)}"><span>${esc(source.label)}</span></div>`;
 }).join('');
}
function updateHighlightToggles(state){
 const any=state.turns.some(t=>t.sources?.some(hasBox));
 document.querySelectorAll('.highlight-toggle').forEach(t=>{t.hidden=!any;t.setAttribute('aria-pressed',String(showHighlights));t.querySelector('b').textContent=showHighlights?'On':'Off'});
}
function toggleHighlights(){showHighlights=!showHighlights;drawHighlights();drawStudioRegions()}
function drawHighlights(){
 if(!project)return;
 const img=$('#drawingImage'),scroll=$('#drawingScroll');
 let layer=$('#viewerRegions');
 if(!layer){layer=document.createElement('div');layer.id='viewerRegions';layer.className='region-layer';scroll.append(layer)}
 const state=chatState(chatKey());updateHighlightToggles(state);
 layer.style.cssText=`left:${img.offsetLeft}px;top:${img.offsetTop}px;width:${img.clientWidth}px;height:${img.clientHeight}px`;
 layer.innerHTML=regionsHtml(state);
}

// Sheet viewer: an entry point to the question page, plus the highlight overlay.
function mountSheetChat(){
 const asked=chatState(chatKey()).turns.filter(t=>t.role==='user').length;
 const cta=document.createElement('button');cta.type='button';cta.className='ask-cta';
 cta.innerHTML=`<span class="ask-cta-icon">${ICON.spark}</span><span class="ask-cta-text"><strong>${asked?'Continue asking about this drawing':'Ask AI about this drawing'}</strong><small>${asked?`${asked} question${asked===1?'':'s'} so far`:'Plain answers that point to the right place on the sheet'}</small></span>${ICON.arrow}`;
 cta.onclick=()=>openAskStudio(currentPage);
 $('#drawingDetails').prepend(cta);
 if(!$('#highlightToggle')){
  const toggle=document.createElement('button');toggle.id='highlightToggle';toggle.type='button';toggle.className='highlight-toggle';
  toggle.innerHTML='<span class="toggle-dot" aria-hidden="true"></span>Highlights <b>On</b>';
  toggle.onclick=toggleHighlights;
  $('.viewer-tools').append(toggle);
 }
 const img=$('#drawingImage');img.onload=drawHighlights;
 if(regionObserver)regionObserver.disconnect();regionObserver=new ResizeObserver(()=>drawHighlights());regionObserver.observe(img);
 drawHighlights();
}

// Question page: a full-screen workspace with the drawing beside the conversation.
const askStudio=document.createElement('dialog');
askStudio.id='askStudio';askStudio.setAttribute('aria-labelledby','studioTitle');
askStudio.innerHTML=`<header class="studio-bar">
 <button type="button" class="studio-back" data-action="close">${ICON.back}<span>Back</span></button>
 <div class="studio-heading"><span class="studio-page" id="studioPage"></span><div><h1 id="studioTitle"></h1><p id="studioSub"></p></div></div>
 <div class="studio-actions">
  <button type="button" class="bar-button" data-action="help" aria-expanded="false" aria-controls="studioHelp">${ICON.help}<span>How it works</span></button>
  <a class="bar-button" id="studioPdf" target="_blank" rel="noopener">${ICON.external}<span>Original PDF</span></a>
 </div>
 <section class="studio-help" id="studioHelp" aria-label="How it works" hidden></section>
</header>
<div class="studio-body">
 <section class="studio-drawing" aria-label="Drawing">
  <div class="studio-canvas" id="studioCanvas"><div class="studio-stage" id="studioStage"><img id="studioImage" alt="" draggable="false"><div class="region-layer" id="studioRegions"></div><div class="region-layer" id="studioPulse"></div></div></div>
  <div class="canvas-tools">
   <button type="button" data-action="zoom-out" aria-label="Zoom out">${ICON.minus}</button>
   <button type="button" class="zoom-level" data-action="zoom-fit" id="studioZoom" aria-label="Fit whole drawing">Fit</button>
   <button type="button" data-action="zoom-in" aria-label="Zoom in">${ICON.plus}</button>
   <button type="button" class="highlight-toggle" data-action="highlights"><span class="toggle-dot" aria-hidden="true"></span>Highlights <b>On</b></button>
  </div>
  <p class="canvas-hint">Drag to move around the drawing</p>
 </section>
 <section class="studio-thread" aria-label="Questions and answers">
  <div class="thread-scroll" role="log" aria-live="polite" tabindex="0"><div class="thread" id="studioThread"></div></div>
  <div class="thread-dock"><div class="dock-inner">
   <div class="scope-bar" id="studioScope" hidden></div>
   <form class="composer" id="studioForm" novalidate>
    <label for="studioQuestion" class="visually-hidden">Your question about this drawing</label>
    <textarea id="studioQuestion" rows="2" maxlength="4000" placeholder="Ask anything about this drawing…"></textarea>
    <div class="composer-row">
     <label class="fresh-toggle"><input type="checkbox" id="studioFresh"> Always write a new answer</label>
     <span class="save-state" id="studioSave" role="status"></span>
     <button class="composer-send" type="submit"><span>Ask</span>${ICON.send}</button>
    </div>
   </form>
  </div></div>
 </section>
</div>`;
document.body.append(askStudio);
const $s=selector=>askStudio.querySelector(selector);
// View-only state; never saved.
const askUi={help:false,usage:new Set(),palette:null,sig:'',returnTo:null,zoom:100,dims:null,active:null,leaving:false};
const STUDIO_ZOOMS=[100,150,200,300,400];

function openAskStudio(page){
 if(!project?.pages[page-1])return;
 askUi.returnTo=$('#viewer').open?'viewer':null;
 if(askUi.returnTo)$('#viewer').close();
 currentPage=page;
 Object.assign(askUi,{help:false,palette:null,sig:'',zoom:100,dims:null,active:null});askUi.usage.clear();
 const s=project.pages[page-1];
 $s('#studioTitle').textContent=s.title;
 $s('#studioSub').textContent=[s.number,s.discipline].filter(Boolean).join(' · ');
 $s('#studioPage').textContent='Page '+page;
 $s('#studioPdf').href=base()+'/pdf#page='+page;
 const img=$s('#studioImage');img.alt=`${s.title}, page ${page}`;img.src=imageUrl(page,2300);
 if(!askStudio.open){askStudio.showModal();if(!askUi.leaving)history.pushState({askStudio:true},'')}
 applyStudioZoom(false);renderStudio();
 $s('.thread-scroll').scrollTop=0;
 if(matchMedia('(pointer: fine)').matches)$s('#studioQuestion').focus();
}
function sheetDims(){const s=project.pages[currentPage-1];return askUi.dims||{w:s.width||1.414,h:s.height||1}}
function applyStudioZoom(keepCenter=true){
 const canvas=$s('#studioCanvas'),stage=$s('#studioStage'),d=sheetDims();
 const fx=(canvas.scrollLeft+canvas.clientWidth/2)/canvas.scrollWidth,fy=(canvas.scrollTop+canvas.clientHeight/2)/canvas.scrollHeight;
 const fit=Math.max(120,Math.min(canvas.clientWidth-56,(canvas.clientHeight-56)*d.w/d.h));
 stage.style.aspectRatio=`${d.w} / ${d.h}`;
 stage.style.width=Math.round(fit*askUi.zoom/100)+'px';
 if(keepCenter){canvas.scrollLeft=fx*canvas.scrollWidth-canvas.clientWidth/2;canvas.scrollTop=fy*canvas.scrollHeight-canvas.clientHeight/2}
 $s('#studioZoom').textContent=askUi.zoom===100?'Fit':askUi.zoom+'%';
 $s('[data-action="zoom-out"]').disabled=askUi.zoom<=100;
 $s('[data-action="zoom-in"]').disabled=askUi.zoom>=400;
 canvas.classList.toggle('can-pan',askUi.zoom>100);
}
function stepStudioZoom(direction){
 askUi.zoom=direction>0?STUDIO_ZOOMS.find(z=>z>askUi.zoom)??400:[...STUDIO_ZOOMS].reverse().find(z=>z<askUi.zoom)??100;
 applyStudioZoom();
}
function drawStudioRegions(state){
 if(!askStudio.open||!project)return;
 state??=chatState(chatKey());updateHighlightToggles(state);
 $s('#studioRegions').innerHTML=regionsHtml(state);
 setActiveRegion(askUi.active,true);
}
// Hovering a place in an answer brings its outline forward on the drawing.
function setActiveRegion(key,force=false){
 if(key===askUi.active&&!force)return;
 askUi.active=key;
 const layer=$s('#studioRegions');let found=false;
 layer.querySelectorAll('.region').forEach(r=>{const on=r.dataset.region===key;r.classList.toggle('is-active',on);found||=on});
 layer.classList.toggle('has-active',found);
}
// Scroll to one region and pulse it, without changing zoom or filters.
function locateInStudio(source,color){
 if(!hasBox(source))return;
 const canvas=$s('#studioCanvas'),stage=$s('#studioStage'),[x0,y0,x1,y1]=source.box;
 const behavior=matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
 canvas.scrollTo({left:stage.offsetLeft+(x0+x1)/2*stage.clientWidth-canvas.clientWidth/2,top:stage.offsetTop+(y0+y1)/2*stage.clientHeight-canvas.clientHeight/2,behavior});
 const pulse=document.createElement('div');pulse.className='region-pulse';pulse.style.cssText=`${boxStyle(source.box)};--c:${color}`;
 $s('#studioPulse').replaceChildren(pulse);setTimeout(()=>pulse.remove(),2600);
}
// Image placement that crops the sheet around a region at a fixed 16:10 ratio,
// with some surrounding context. The thumbnail itself stays unmarked.
function cropStyle(box,W,H){
 const RATIO=1.6,[x0,y0,x1,y1]=[box[0]*W,box[1]*H,box[2]*W,box[3]*H];
 const pad=Math.max(x1-x0,y1-y0)*.12+W*.01;
 let w=Math.max(x1-x0+pad*2,W*.1),h=Math.max(y1-y0+pad*2,W*.1/RATIO);
 if(w/h<RATIO)w=h*RATIO;else h=w/RATIO;
 const X=w>W?(W-w)/2:Math.min(Math.max((x0+x1)/2-w/2,0),W-w);
 const Y=h>H?(H-h)/2:Math.min(Math.max((y0+y1)/2-h/2,0),H-h);
 return `width:${W/w*100}%;left:${-X/w*100}%;top:${-Y/h*100}%`;
}
// Plain answer text with simple bullet and numbered lines turned into lists.
function formatAnswer(text){
 const out=[];let list=null,para=[];
 const flushPara=()=>{if(para.length)out.push(`<p>${para.join('<br>')}</p>`);para=[]};
 const flushList=()=>{if(list)out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`);list=null};
 for(const raw of String(text).split('\n')){
  const line=raw.trim(),item=line.match(/^(?:[•*–-]\s+|(\d+)[.)]\s+)(.+)$/);
  if(!line){flushPara();flushList();continue}
  if(!item){flushList();para.push(esc(line));continue}
  const tag=item[1]?'ol':'ul';flushPara();
  if(list?.tag!==tag){flushList();list={tag,items:[]}}
  list.items.push(`<li>${esc(item[2])}</li>`);
 }
 flushPara();flushList();return out.join('');
}

function renderStudio(){
 if(!askStudio.open||!project)return;
 const key=chatKey(),state=chatState(key),locked=state.busy||state.saving;
 renderStudioHelp(state);
 renderThread(key,state,locked);
 renderScope(state,locked);
 const question=$s('#studioQuestion');if(question.value!==(state.draft||''))question.value=state.draft||'';autoGrow(question);
 const send=$s('.composer-send');send.disabled=locked;
 send.firstElementChild.textContent=state.busy?'Reading…':state.saving?'Saving…':'Ask';
 const status=state.saveStatus||'',save=$s('#studioSave');
 save.classList.toggle('is-error',status.startsWith('Save failed'));
 save.textContent=status==='Saved to project'?'✓ Saved':status==='No saved changes yet'?'':status;
 drawStudioRegions(state);
}
function renderStudioHelp(state){
 const panel=$s('#studioHelp');panel.hidden=!askUi.help;
 $s('.studio-actions [data-action="help"]').setAttribute('aria-expanded',String(askUi.help));
 if(!askUi.help)return;
 panel.innerHTML=`<div class="help-head"><h2>How it works</h2><button type="button" class="icon-button" data-action="help" aria-label="Close">${ICON.close}</button></div>
 <ul>
  <li>Only this drawing is sent to the AI. Other sheets are never used, even if this one mentions them.</li>
  <li>Outlines on the drawing show where an answer comes from. Dashed outlines are the AI’s best guess and may be slightly off.</li>
  <li>Use <b>Show on drawing</b> to choose which answers are outlined. Your next question focuses on the outlined answers.</li>
  <li>Asking the same question again reuses the saved answer for free. New answers use paid AI credits.</li>
  <li>Questions, answers and outlines are saved with this project.</li>
 </ul>
 <div class="usage-summary"><h3>This conversation so far</h3>${chatUsageHtml(totalUsage(state.turns))}</div>`;
}
function renderThread(key,state,locked){
 const scroller=$s('.thread-scroll'),thread=$s('#studioThread'),turns=state.turns;
 const sig=[key,turns.length,state.busy,!!state.previousChoice,!!state.error].join('|');
 const keep=scroller.scrollTop;
 let html='';
 if(!turns.length&&!state.busy&&!state.previousChoice&&!state.error)html=studioHero(locked);
 else{
  for(let i=0;i<turns.length;i++){
   if(turns[i].role==='user'&&turns[i+1]?.role==='assistant'){html+=answerBlock(state,i+1,turns[i].content,locked);i++}
   else if(turns[i].role==='assistant')html+=answerBlock(state,i,'',locked);
   else html+=`<article class="qa">${questionHeading(turns[i].content)}</article>`;
  }
  if(state.busy)html+=`<article class="qa">${questionHeading(state.pending)}${thinkingBlock()}</article>`;
  if(state.previousChoice)html+=`<article class="qa">${questionHeading(state.previousChoice.question)}${choiceCard(state.previousChoice,locked)}</article>`;
  if(state.error)html+=`<article class="qa">${state.failed?questionHeading(state.failed):''}${errorCard(state.error,locked)}</article>`;
 }
 thread.innerHTML=html;
 // New content opens at the start of the latest question; re-renders keep the reader's place.
 if(sig===askUi.sig)scroller.scrollTop=keep;
 else{const last=[...thread.querySelectorAll('.qa')].pop();scroller.scrollTop=last?Math.max(0,last.offsetTop-28):0}
 askUi.sig=sig;
}
const questionHeading=text=>`<h2 class="qa-question">${esc(text)}</h2>`;
const assistantLine=extra=>`<div class="qa-by"><span class="qa-avatar" aria-hidden="true">${ICON.spark}</span><span>${extra}</span></div>`;
function studioHero(locked){
 const prompts=[['Explain this drawing in simple words.','layout'],['What dimensions are shown?','ruler'],['What work is marked on this sheet?','pencil'],['Summarize the notes on this sheet.','notes']];
 return `<div class="hero">
 <span class="hero-icon">${ICON.spark}</span>
 <h2>What would you like to know?</h2>
 <p>Ask in your own words. I read only this drawing, and I’ll point to the places I’m talking about.</p>
 <h3 class="visually-hidden">Suggested questions</h3>
 <div class="suggestions">${prompts.map(([q,icon])=>`<button type="button" data-action="prompt" data-prompt="${esc(q)}"><span class="suggestion-icon">${ICON[icon]}</span><span>${esc(q)}</span></button>`).join('')}</div>
 <p class="hero-note">Choosing one only fills in the question box. Nothing is sent until you press Ask.</p>
</div>`;
}
function answerBlock(state,i,question,locked){
 const t=state.turns[i],n=answerNumber(i),owner=highlightOwner(state,i),own=owner===i,color=replyColor(state,owner);
 const sources=state.turns[owner]?.sources||[],placed=sources.map((s,k)=>[s,k]).filter(([s])=>hasBox(s)),unplaced=sources.filter(s=>!hasBox(s));
 const shown=state.selected==null||state.selected.includes(i),dims=sheetDims(),usageOpen=askUi.usage.has(i);
 const card=([s,k])=>{const crop=cropStyle(s.box,dims.w,dims.h);return `<button type="button" class="place" data-action="locate" data-turn="${owner}" data-source="${k}" data-region-ref="${regionKey(s.box)}" style="--c:${color}">
  <span class="place-crop"><img src="${imageUrl(currentPage,2300)}" alt="" loading="lazy" style="${crop}"></span>
  <span class="place-text"><strong>${esc(s.label)}</strong><small>${kindLabel(s)}</small></span></button>`};
 return `<article class="qa" aria-label="Answer ${n}">
 ${question?questionHeading(question):''}
 ${assistantLine(`Answer ${n}`)}
 ${t.cached?`<p class="qa-free">${ICON.check}Saved answer reused, no extra cost</p>`:''}
 <div class="prose">${formatAnswer(t.content)}</div>
 ${placed.length?`<section class="places"><div class="places-head"><h3>Where to look</h3><p>Choose one to find it on the drawing${own?'':` · same places as answer ${answerNumber(owner)}`}</p></div><div class="places-grid">${placed.map(card).join('')}</div></section>`:''}
 ${unplaced.length?`<p class="qa-also">Also mentioned, not outlined: ${unplaced.map(s=>esc(s.label)).join(', ')}</p>`:''}
 <div class="qa-foot">
  ${own&&sources.length?`<label class="switch"><input type="checkbox" role="switch" data-filter="${i}" ${shown?'checked':''} ${locked?'disabled':''}><span class="switch-track" aria-hidden="true"></span><span>Show on drawing</span></label>
  <button type="button" class="swatch-button" data-action="palette" data-turn="${i}" aria-expanded="${askUi.palette===i}" aria-label="Outline color for answer ${n}" ${locked?'disabled':''}><span class="swatch" style="--c:${color}"></span>Color</button>`:''}
  <button type="button" class="link-button" data-action="usage" data-turn="${i}" aria-expanded="${usageOpen}">Cost ${ICON.chevron}</button>
 </div>
 ${own&&askUi.palette===i?`<div class="palette" role="group" aria-label="Outline color for answer ${n}">${HIGHLIGHT_COLORS.map(([c,name])=>`<button type="button" data-action="color" data-turn="${i}" data-color="${c}" aria-pressed="${c===color.toLowerCase()}" ${locked?'disabled':''}><span class="swatch" style="--c:${c}"></span>${name}</button>`).join('')}</div>`:''}
 ${usageOpen?`<div class="qa-usage">${t.cached?'<p>This reply reused a saved answer, so no new tokens were used.</p>':''}${chatUsageHtml(t.usage)}</div>`:''}
</article>`;
}
const thinkingBlock=()=>`<div class="thinking" role="status">${assistantLine('Reading this drawing<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>')}
 <div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div>
 <p class="muted">This can take up to a minute. You can go back and keep browsing; the answer will be saved here.</p></div>`;
function choiceCard(choice,locked){
 return `<section class="notice" aria-labelledby="choiceTitle">
 <h3 id="choiceTitle">You’ve asked this before</h3>
 <p>There’s a saved answer, but something has changed since then, such as which answers are shown on the drawing. Nothing has been sent to the AI yet.</p>
 <blockquote>${esc(choice.previous_answer)}</blockquote>
 <div class="notice-actions"><button type="button" class="primary" data-action="use-previous" ${locked?'disabled':''}><span>Use saved answer</span><small>Free</small></button><button type="button" data-action="fresh-previous" ${locked?'disabled':''}><span>Get a new answer</span><small>Uses AI credits</small></button></div>
 <button type="button" class="link-button" data-action="dismiss-choice">Cancel and edit my question</button>
 <details><summary>Why am I seeing this?</summary><p>${esc(choice.reason)}</p></details>
</section>`;
}
const errorCard=(error,locked)=>`<section class="notice is-error" role="alert"><h3>${ICON.alert}Couldn’t get an answer</h3><p>${esc(error)}</p><div class="notice-actions is-row"><button type="button" class="primary" data-action="retry" ${locked?'disabled':''}><span>Try again</span></button>${/AI settings/i.test(error)?'<button type="button" data-action="settings"><span>Open AI settings</span></button>':''}<button type="button" data-action="dismiss-error"><span>Dismiss</span></button></div></section>`;
function renderScope(state,locked){
 const bar=$s('#studioScope'),selected=state.selected;
 bar.hidden=selected==null;
 if(selected==null){bar.innerHTML='';return}
 const numbers=[...new Set(selected.map(i=>answerNumber(highlightOwner(state,i))))].sort((a,b)=>a-b);
 const text=numbers.length?`Your next question will focus on the places from <strong>${listWords(numbers.map(n=>'answer '+n))}</strong>.`:'No answers are shown on the drawing, so your next question won’t focus on any places.';
 bar.innerHTML=`<span class="scope-icon">${ICON.target}</span><p>${text}</p><button type="button" data-action="clear-filters" ${locked?'disabled':''}>Show all</button>`;
}
function autoGrow(field){if(!field.offsetParent)return;field.style.height='auto';field.style.height=Math.min(field.scrollHeight,180)+'px'}

async function persistConversation(key){
 const state=chatState(key),[pid,page]=key.split(':');state.saving=true;state.saveStatus='Saving…';saveChats();
 try{const saved=await api(`/api/projects/${pid}/pages/${page}/conversation`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({turns:state.turns,updated:Date.now(),revision:state.revision||0,selected:state.selected??null,colors:state.colors||{}})});state.revision=saved.revision;state.saveStatus='Saved to project';saveChats()}
 catch(e){state.saveStatus='Save failed: '+e.message;toast(state.saveStatus)}
 finally{state.saving=false;if(project&&chatKey()===key)renderStudio()}
}
async function loadSavedChats(pid){
 const saved=await api(`/api/projects/${pid}/chats`);
 for(const [page,state] of Object.entries(saved))sheetChats.set(pid+':'+page,{...state,draft:'',busy:false,error:'',failed:'',pending:null,saveStatus:'Saved to project'});
 for(const [key,state] of sheetChats)if(key.startsWith(pid+':')&&!saved[key.split(':')[1]]&&state.turns.length)await persistConversation(key);
 saveChats();
}
async function sendSheetQuestion(key,fresh=false,reuseTurn=null){
 const state=chatState(key),question=(state.draft||'').trim();if(state.busy||state.saving||!question)return;
 const pid=project.id,page=currentPage;
 Object.assign(state,{busy:true,error:'',failed:'',pending:question,previousChoice:null,draft:''});askUi.palette=null;renderStudio();
 try{
  const result=await api(`/api/projects/${pid}/pages/${page}/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,fresh,reuse_turn:reuseTurn,history:state.turns.slice(-20).map(t=>({role:t.role,content:t.content}))})});
  if(result.needs_choice){state.previousChoice={...result,question};return}
  if(result.conversation){state.turns=result.conversation.turns;state.revision=result.conversation.revision}else state.turns.push({role:'user',content:question},{role:'assistant',content:result.answer,usage:result.usage||{},sources:result.sources||[]});state.updated=Date.now();state.saveStatus='Saved to project';saveChats();
 }catch(e){state.error=e.message;state.failed=question;if(!(state.draft||'').trim())state.draft=question}
 finally{state.busy=false;state.pending=null;if(project?.id===pid&&currentPage===page)renderStudio()}
}

// Question page events
askStudio.addEventListener('click',e=>{
 if(askUi.help&&!e.target.closest('#studioHelp,[data-action="help"]')){askUi.help=false;renderStudio()}
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
 const key=chatKey(),state=chatState(key),turn=Number(b.dataset.turn),fresh=$s('#studioFresh').checked;
 switch(b.dataset.action){
  case 'close':askStudio.close();break;
  case 'help':askUi.help=!askUi.help;renderStudio();break;
  case 'zoom-in':stepStudioZoom(1);break;
  case 'zoom-out':stepStudioZoom(-1);break;
  case 'zoom-fit':askUi.zoom=100;applyStudioZoom(false);break;
  case 'highlights':toggleHighlights();break;
  case 'prompt':{state.draft=b.dataset.prompt;renderStudio();const q=$s('#studioQuestion');q.focus();q.setSelectionRange(q.value.length,q.value.length);break}
  case 'locate':locateInStudio(state.turns[turn]?.sources?.[Number(b.dataset.source)],replyColor(state,turn));break;
  case 'usage':askUi.usage.has(turn)?askUi.usage.delete(turn):askUi.usage.add(turn);renderStudio();break;
  case 'palette':askUi.palette=askUi.palette===turn?null:turn;renderStudio();break;
  case 'color':state.colors={...state.colors,[turn]:b.dataset.color};askUi.palette=null;persistConversation(key);renderStudio();break;
  case 'clear-filters':state.selected=null;persistConversation(key);renderStudio();break;
  case 'use-previous':state.draft=state.previousChoice.question||state.draft;sendSheetQuestion(key,false,state.previousChoice.previous_turn);break;
  case 'fresh-previous':state.draft=state.previousChoice.question||state.draft;sendSheetQuestion(key,true);break;
  case 'dismiss-choice':state.draft=state.previousChoice?.question||state.draft;state.previousChoice=null;renderStudio();$s('#studioQuestion').focus();break;
  case 'retry':state.draft=state.failed||state.draft;sendSheetQuestion(key,fresh);break;
  case 'dismiss-error':state.error='';state.failed='';renderStudio();$s('#studioQuestion').focus();break;
  case 'settings':$('#settings').showModal();break;
 }
});
askStudio.addEventListener('change',e=>{
 if(!e.target.matches('[data-filter]'))return;
 const key=chatKey(),state=chatState(key);
 state.selected=[...askStudio.querySelectorAll('[data-filter]:checked')].map(x=>Number(x.dataset.filter));
 persistConversation(key);renderStudio();
});
const studioQuestion=$s('#studioQuestion');
studioQuestion.addEventListener('input',()=>{
 const state=chatState(chatKey());state.draft=studioQuestion.value;autoGrow(studioQuestion);
 if(state.previousChoice){state.previousChoice=null;renderStudio()}
});
studioQuestion.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$s('#studioForm').requestSubmit()}});
$s('#studioForm').addEventListener('submit',e=>{
 e.preventDefault();const key=chatKey();
 if(!(chatState(key).draft||'').trim()){const box=$s('.composer');box.classList.remove('needs-text');void box.offsetWidth;box.classList.add('needs-text');studioQuestion.focus();return}
 sendSheetQuestion(key,$s('#studioFresh').checked);
});
const studioThread=$s('#studioThread');
studioThread.addEventListener('pointerover',e=>setActiveRegion(e.target.closest('[data-region-ref]')?.dataset.regionRef??null));
studioThread.addEventListener('pointerleave',()=>setActiveRegion(null));
studioThread.addEventListener('focusin',e=>setActiveRegion(e.target.closest('[data-region-ref]')?.dataset.regionRef??null));
studioThread.addEventListener('focusout',()=>setActiveRegion(null));
$s('#studioImage').addEventListener('load',e=>{
 askUi.dims={w:e.target.naturalWidth,h:e.target.naturalHeight};
 applyStudioZoom(false);renderStudio();
});
// Mouse users can drag to pan and double-click to zoom; touch keeps native scrolling.
const studioCanvas=$s('#studioCanvas');
let studioPan=null;
studioCanvas.addEventListener('pointerdown',e=>{
 if(e.pointerType!=='mouse'||e.button!==0||askUi.zoom<=100)return;
 studioPan={id:e.pointerId,x:e.clientX,y:e.clientY,left:studioCanvas.scrollLeft,top:studioCanvas.scrollTop};
 studioCanvas.setPointerCapture(e.pointerId);studioCanvas.classList.add('is-panning');
});
studioCanvas.addEventListener('pointermove',e=>{
 if(studioPan?.id!==e.pointerId)return;
 studioCanvas.scrollLeft=studioPan.left-(e.clientX-studioPan.x);studioCanvas.scrollTop=studioPan.top-(e.clientY-studioPan.y);
});
const endStudioPan=()=>{studioPan=null;studioCanvas.classList.remove('is-panning')};
studioCanvas.addEventListener('pointerup',endStudioPan);studioCanvas.addEventListener('pointercancel',endStudioPan);
studioCanvas.addEventListener('dblclick',e=>{
 const stage=$s('#studioStage').getBoundingClientRect();if(askUi.zoom>=400)return;
 const rx=(e.clientX-stage.left)/stage.width,ry=(e.clientY-stage.top)/stage.height;
 stepStudioZoom(1);
 const next=$s('#studioStage'),canvasBox=studioCanvas.getBoundingClientRect();
 studioCanvas.scrollLeft=next.offsetLeft+rx*next.clientWidth-(e.clientX-canvasBox.left);
 studioCanvas.scrollTop=next.offsetTop+ry*next.clientHeight-(e.clientY-canvasBox.top);
});
studioCanvas.addEventListener('wheel',e=>{
 if(!e.ctrlKey)return;e.preventDefault();
 askUi.zoom=Math.round(Math.min(400,Math.max(100,askUi.zoom*(e.deltaY<0?1.1:1/1.1))));applyStudioZoom();
},{passive:false});
new ResizeObserver(()=>{if(askStudio.open)applyStudioZoom()}).observe(studioCanvas);
// Esc closes an open popover first; the page itself closes on the next Esc.
askStudio.addEventListener('cancel',e=>{
 if(!askUi.help&&askUi.palette===null)return;
 e.preventDefault();askUi.help=false;askUi.palette=null;renderStudio();
});
// The question page is a browser history entry, so the browser Back button closes it too.
askStudio.addEventListener('close',()=>{
 askUi.help=false;
 if(history.state?.askStudio){askUi.leaving=true;history.back()}
 const returnTo=askUi.returnTo;askUi.returnTo=null;
 if(!project)return;
 if(returnTo==='viewer')openPage(currentPage);
 else if(route==='chat')render();
});
window.addEventListener('popstate',()=>{
 if(askUi.leaving){askUi.leaving=false;if(askStudio.open)history.pushState({askStudio:true},'');return}
 if(askStudio.open)askStudio.close();
});
// Keep the Ask drawings page's recent conversations current after the viewer closes.
$('#viewer').addEventListener('close',()=>{if(project&&route==='chat'&&!askStudio.open)render()});
renderChatHistory();
