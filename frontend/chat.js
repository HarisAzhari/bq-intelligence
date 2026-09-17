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
 book:svg('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7.5h8M8 11h5"/>'),
 upload:svg('<path d="M12 16V4M6.5 9.5 12 4l5.5 5.5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
 receipt:svg('<path d="M6.5 3.5h11v17l-2.2-1.5-2.2 1.5-2.2-1.5-2.2 1.5-2.2-1.5z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>'),
 prev:svg('<path d="m15 6-6 6 6 6"/>'),
 next:svg('<path d="m9 6 6 6-6 6"/>'),
};

// The two reference PDFs a project can carry beside its drawings: the technical specification
// ("how to work") and the cost breakdown (bill of quantities). Both are indexed on the server
// without AI, and both are read for every question about a drawing.
const DOCS={
 spec:{
  icon:'book',cite:'Spec',navLabel:'SPECIFICATION',navAdd:'Add how-to-work PDF',navBusy:'Reading specification…',
  title:'Technical specification',lower:'technical specification',browse:'Specification',
  busyTitle:'Reading your technical specification…',
  addTitle:'Add the project’s technical specification',
  addText:'The “how to work” PDF for this project. Once added, the AI refers to it for every question about these drawings. It finds the matching pages through codes like FF-06 and explains what to use and how to do the work.',
  addButton:'Add specification PDF',
  linkedText:'The AI refers to this for every question about these drawings.',
  refsTitle:'From the specification',refsChanged:'The linked specification has changed since this answer',refsNone:'No specification is linked now',
  removed:'Specification removed from this project.',
  linkedToast:d=>`Specification linked: ${d.item_count} coded items found in ${d.page_count} pages.`,
  get:()=>project?.spec||null,set:v=>{if(project)project.spec=v},
  refs:t=>t?.spec_refs||[],hash:t=>t?.spec_hash,
 },
 cost:{
  icon:'receipt',cite:'Cost',navLabel:'COST BREAKDOWN',navAdd:'Add cost breakdown PDF',navBusy:'Reading cost breakdown…',
  title:'Cost breakdown',lower:'cost breakdown',browse:'Cost breakdown',
  busyTitle:'Reading your cost breakdown…',
  addTitle:'Add the project’s cost breakdown',
  addText:'The priced PDF for this project: a bill of quantities, schedule of rates or cost plan. Once added, the AI reads it for every question too, and quotes the measured items, units, quantities and rates exactly as printed.',
  addButton:'Add cost breakdown PDF',
  linkedText:'The AI reads this for every question, alongside the specification.',
  refsTitle:'From the cost breakdown',refsChanged:'The linked cost breakdown has changed since this answer',refsNone:'No cost breakdown is linked now',
  removed:'Cost breakdown removed from this project.',
  linkedToast:d=>`Cost breakdown linked: ${d.page_count} pages read${d.item_count?`, ${d.item_count} coded items found`:''}.`,
  get:()=>project?.cost||null,set:v=>{if(project)project.cost=v},
  refs:t=>t?.cost_refs||[],hash:t=>t?.cost_hash,
 },
};
const DOC_KINDS=Object.keys(DOCS);
const docUi={spec:{uploading:false,error:''},cost:{uploading:false,error:''}};
const docInput=Object.assign(document.createElement('input'),{type:'file',accept:'application/pdf,.pdf',hidden:true});
document.body.append(docInput);
let docChoosing='spec';
docInput.addEventListener('change',()=>uploadDoc(docChoosing,docInput.files[0]));
const projectDoc=kind=>DOCS[kind].get();
const projectSpec=()=>projectDoc('spec');
const projectCost=()=>projectDoc('cost');
const docImage=(kind,page,width)=>`${base()}/${kind}/pages/${page}/image?width=${width}&v=${projectDoc(kind)?.hash.slice(0,12)||''}`;
// References written against a different or removed document no longer open.
const docCurrent=(kind,turn)=>!!projectDoc(kind)&&DOCS[kind].hash(turn)===projectDoc(kind).hash;
function chooseDocFile(kind){if(!docUi[kind].uploading&&project){docChoosing=kind;docInput.click()}}
async function uploadDoc(kind,file){
 const doc=DOCS[kind];
 if(!file||!project)return;
 if(!file.name.toLowerCase().endsWith('.pdf')){toast(`Choose the ${doc.lower} as a PDF file.`);docInput.value='';return}
 const pid=project.id;
 docUi[kind].uploading=true;docUi[kind].error='';refreshSpecViews();
 try{
  const data=new FormData();data.append('file',file);
  const saved=await api(`/api/projects/${pid}/${kind}`,{method:'POST',body:data});
  if(project?.id===pid){doc.set(saved);toast(doc.linkedToast(saved))}
 }catch(e){docUi[kind].error=e.message;toast(e.message)}
 finally{docUi[kind].uploading=false;docInput.value='';refreshSpecViews()}
}
async function removeDoc(kind){
 const doc=DOCS[kind],current=projectDoc(kind);if(!current)return;
 if(!confirm(`Remove “${current.filename}” from this project?\n\nSaved answers stay, but their ${doc.lower} pages will no longer open.`))return;
 const pid=project.id;
 try{await api(`/api/projects/${pid}/${kind}`,{method:'DELETE'});if(project?.id===pid)doc.set(null);toast(doc.removed)}
 catch(e){toast(e.message)}
 finally{refreshSpecViews()}
}
function refreshSpecViews(){
 if(typeof refreshTenderState==='function')refreshTenderState();
 renderSpecNav();
 for(const kind of DOC_KINDS){const panel=document.querySelector(`#${kind}Panel`);if(panel)panel.outerHTML=docPanelHtml(kind)}
 if(askStudio.open){if(askUi.doc&&!projectDoc(askUi.doc.kind))showDrawing();renderStudio()}
}
// Sidebar entries under the project picker.
function renderSpecNav(){
 if(typeof renderTenderNav==='function')renderTenderNav();
 for(const kind of DOC_KINDS)renderDocNav(kind);
}
function renderDocNav(kind){
 const doc=DOCS[kind],nav=$('#'+kind+'Nav');if(!nav)return;
 nav.hidden=!project;if(!project){nav.innerHTML='';return}
 const current=projectDoc(kind);
 let body;
 if(docUi[kind].uploading)body=`<div class="spec-nav-item is-busy" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span class="spec-nav-text"><strong>${doc.navBusy}</strong><small>On this computer, no AI</small></span></div>`;
 else if(!current)body=`<button type="button" class="spec-nav-add" data-doc-action="upload" data-doc="${kind}">${ICON.plus}<span>${doc.navAdd}</span></button>`;
 else body=`<div class="spec-nav-item"><span class="spec-nav-icon">${ICON[doc.icon]}</span><span class="spec-nav-text"><strong title="${esc(current.filename)}">${esc(current.filename.replace(/\.pdf$/i,''))}</strong><small>${current.page_count} pages${current.item_count?` · ${current.item_count} items`:''}</small></span></div>
  <div class="spec-nav-actions"><a href="${base()}/${kind}/pdf" target="_blank" rel="noopener">Open</a><button type="button" data-doc-action="upload" data-doc="${kind}">Replace</button><button type="button" data-doc-action="remove" data-doc="${kind}">Remove</button></div>`;
 nav.innerHTML=`<div class="project-label">${doc.navLabel}</div>${body}`;
}
// Cards on the project overview.
function specPanelHtml(){
 return DOC_KINDS.map(docPanelHtml).join('')+(typeof tenderPanelHtml==='function'?tenderPanelHtml():'');
}
function docPanelHtml(kind){
 const doc=DOCS[kind],current=projectDoc(kind),ui=docUi[kind],error=ui.error?`<p class="spec-error">${esc(ui.error)}</p>`:'';
 if(ui.uploading)return `<section id="${kind}Panel" class="spec-panel is-busy is-${kind}"><span class="spec-panel-icon"><span class="spinner" aria-hidden="true"></span></span><div><h3>${doc.busyTitle}</h3><p>This happens on this computer and nothing is sent to the AI. A long file can take a minute or two.</p></div></section>`;
 if(!current)return `<section id="${kind}Panel" class="spec-panel is-${kind}"><span class="spec-panel-icon">${ICON[doc.icon]}</span><div><h3>${doc.addTitle}</h3><p>${doc.addText}</p>${error}</div><button type="button" class="primary" data-doc-action="upload" data-doc="${kind}">${ICON.upload}<span>${doc.addButton}</span></button></section>`;
 return `<section id="${kind}Panel" class="spec-panel is-linked is-${kind}"><span class="spec-panel-icon">${ICON[doc.icon]}</span><div><h3>${doc.title}</h3><p>${doc.linkedText}</p><p><strong>${esc(current.filename)}</strong> · ${current.page_count} page${current.page_count===1?'':'s'}${current.item_count?` · ${current.item_count} coded item${current.item_count===1?'':'s'} found`:''}</p>${current.blank_pages?`<p class="spec-warn">${current.blank_pages} page${current.blank_pages===1?'':'s'} can’t be fully read as text (scans or unusual fonts). When one is needed, the AI is shown a picture of it instead.</p>`:''}${error}</div><div class="spec-panel-actions"><a href="${base()}/${kind}/pdf" target="_blank" rel="noopener">Open PDF</a><button type="button" data-doc-action="upload" data-doc="${kind}">Replace</button><button type="button" data-doc-action="remove" data-doc="${kind}">Remove</button></div></section>`;
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-doc-action]');if(!b)return;
 const kind=DOCS[b.dataset.doc]?b.dataset.doc:'spec';
 if(b.dataset.docAction==='upload')chooseDocFile(kind);else if(b.dataset.docAction==='remove')removeDoc(kind);
});

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
 const any=state.turns.some(t=>t.sources?.some(hasBox))||(askStudio.open&&specMarks(state).length>0);
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
 cta.innerHTML=`<span class="ask-cta-icon">${ICON.spark}</span><span class="ask-cta-text"><strong>${asked?'Continue asking about this drawing':'Ask AI about this drawing'}</strong><small>${asked?`${asked} question${asked===1?'':'s'} so far`:projectSpec()?'Answers use this drawing and your technical specification':'Plain answers that point to the right place on the sheet'}</small></span>${ICON.arrow}`;
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
  <button type="button" class="bar-button" data-action="doc-browse" data-doc="spec" id="specBrowse" aria-pressed="false" hidden>${ICON.book}<span>Specification</span></button>
  <button type="button" class="bar-button" data-action="doc-browse" data-doc="cost" id="costBrowse" aria-pressed="false" hidden>${ICON.receipt}<span>Cost breakdown</span></button>
  <button type="button" class="bar-button" data-action="help" aria-expanded="false" aria-controls="studioHelp">${ICON.help}<span>How it works</span></button>
  <a class="bar-button" id="studioPdf" target="_blank" rel="noopener">${ICON.external}<span>Original PDF</span></a>
 </div>
 <section class="studio-help" id="studioHelp" aria-label="How it works" hidden></section>
</header>
<div class="studio-body">
 <section class="studio-drawing" aria-label="Drawing">
  <div class="studio-canvas" id="studioCanvas"><div class="studio-stage" id="studioStage"><img id="studioImage" alt="" draggable="false"><div class="region-layer" id="studioRegions"></div><div class="region-layer" id="studioPulse"></div></div></div>
  <div class="doc-bar" id="docBar" hidden>
   <span class="doc-kind" id="docKind"></span>
   <div class="doc-pager"><button type="button" data-action="doc-prev" aria-label="Previous page">${ICON.prev}</button><span id="docPage" aria-live="polite"></span><button type="button" data-action="doc-next" aria-label="Next page">${ICON.next}</button></div>
   <a id="docPdf" target="_blank" rel="noopener">${ICON.external}<span>Open PDF</span></a>
   <button type="button" class="doc-back" data-action="show-drawing">${ICON.back}<span class="label-long">Back to drawing</span><span class="label-short">Drawing</span></button>
  </div>
  <div class="canvas-tools">
   <button type="button" data-action="zoom-out" aria-label="Zoom out">${ICON.minus}</button>
   <button type="button" class="zoom-level" data-action="zoom-fit" id="studioZoom" aria-label="Fit whole drawing">Fit</button>
   <button type="button" data-action="zoom-in" aria-label="Zoom in">${ICON.plus}</button>
   <button type="button" class="highlight-toggle" data-action="highlights"><span class="toggle-dot" aria-hidden="true"></span>Highlights <b>On</b></button>
  </div>
  <p class="canvas-hint">Drag to move around</p>
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
// doc: null while the drawing is shown, or {kind, page, turn} for a reference document page.
const askUi={help:false,usage:new Set(),palette:null,sig:'',returnTo:null,zoom:100,dims:null,drawDims:null,active:null,leaving:false,doc:null,lastPage:{spec:1,cost:1},afterLoad:null};
const STUDIO_ZOOMS=[100,150,200,300,400];

function openAskStudio(page){
 if(!project?.pages[page-1])return;
 askUi.returnTo=$('#viewer').open?'viewer':null;
 if(askUi.returnTo)$('#viewer').close();
 currentPage=page;
 Object.assign(askUi,{help:false,palette:null,sig:'',zoom:100,dims:null,drawDims:null,active:null,doc:null,afterLoad:null});askUi.usage.clear();
 const s=project.pages[page-1];
 $s('#studioTitle').textContent=s.title;
 $s('#studioSub').textContent=[s.number,s.discipline].filter(Boolean).join(' · ');
 $s('#studioPage').textContent='Page '+page;
 $s('#studioPdf').href=base()+'/pdf#page='+page;
 const img=$s('#studioImage');img.alt=`${s.title}, page ${page}`;img.src=imageUrl(page,2300);
 if(!askStudio.open){askStudio.showModal();if(!askUi.leaving)history.pushState({askStudio:true},'')}
 renderDocBar();applyStudioZoom(false);renderStudio();
 $s('.thread-scroll').scrollTop=0;
 if(matchMedia('(pointer: fine)').matches)$s('#studioQuestion').focus();
}
function drawingDims(){const s=project.pages[currentPage-1];return askUi.drawDims||{w:s.width||1.414,h:s.height||1}}
// Shown document: the drawing, or a reference page (A4 portrait until its image loads).
function viewDims(){return askUi.dims||(askUi.doc?{w:1,h:1.414}:drawingDims())}
function applyStudioZoom(keepCenter=true){
 const canvas=$s('#studioCanvas'),stage=$s('#studioStage'),d=viewDims();
 const fx=(canvas.scrollLeft+canvas.clientWidth/2)/canvas.scrollWidth,fy=(canvas.scrollTop+canvas.clientHeight/2)/canvas.scrollHeight;
 const pad=getComputedStyle(canvas),fitW=canvas.clientWidth-parseFloat(pad.paddingLeft)-parseFloat(pad.paddingRight),fitH=canvas.clientHeight-parseFloat(pad.paddingTop)-parseFloat(pad.paddingBottom);
 const fit=Math.max(120,Math.min(fitW,fitH*d.w/d.h));
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
 $s('#studioRegions').innerHTML=askUi.doc?specMarksHtml(state):regionsHtml(state);
 if(!askUi.doc)setActiveRegion(askUi.active,true);
}
// Where an answer's quoted wording sits on the reference page being shown.
function specMarks(state){
 const doc=askUi.doc;if(!doc||doc.turn==null)return [];
 const turn=state.turns[highlightOwner(state,doc.turn)];
 if(!docCurrent(doc.kind,turn))return [];
 return DOCS[doc.kind].refs(turn).filter(r=>r.page===doc.page).flatMap(r=>(r.boxes||[]).filter(box=>hasBox({box})));
}
// Unlabelled: a label would cover the neighbouring lines of text.
function specMarksHtml(state){
 const marks=showHighlights?specMarks(state):[];if(!marks.length)return '';
 const color=replyColor(state,highlightOwner(state,askUi.doc.turn));
 return marks.map(box=>`<div class="region spec-mark" style="${boxStyle(box)};--c:${color}"></div>`).join('');
}
function renderDocBar(){
 const open=askUi.doc,pane=$s('.studio-drawing');
 $s('#docBar').hidden=!open;
 pane.classList.toggle('is-spec',!!open);
 pane.setAttribute('aria-label',open?DOCS[open.kind].title+' page':'Drawing');
 for(const kind of DOC_KINDS){
  const button=$s('#'+kind+'Browse');
  button.hidden=!projectDoc(kind);
  button.setAttribute('aria-pressed',String(open?.kind===kind));
 }
 const current=open&&projectDoc(open.kind);if(!current)return;
 const doc=DOCS[open.kind];
 $s('#docKind').innerHTML=`${ICON[doc.icon]}<span>${doc.title}</span>`;
 $s('#docPage').textContent=`Page ${open.page} of ${current.page_count}`;
 $s('#docPdf').href=`${base()}/${open.kind}/pdf#page=${open.page}`;
 $s('[data-action="doc-prev"]').disabled=open.page<=1;
 $s('[data-action="doc-next"]').disabled=open.page>=current.page_count;
}
function swapImage(src,alt,then){
 Object.assign(askUi,{dims:null,zoom:100,active:null,afterLoad:then||null});
 const img=$s('#studioImage');img.alt=alt;img.src=src;
 renderDocBar();applyStudioZoom(false);
 const canvas=$s('#studioCanvas');canvas.scrollTop=0;canvas.scrollLeft=0;
 $s('#studioPulse').replaceChildren();drawStudioRegions();
}
function showDocPage(kind,page,turn=null,then=null){
 const current=projectDoc(kind);if(!current||!(page>=1&&page<=current.page_count))return;
 askUi.lastPage[kind]=page;
 if(askUi.doc?.kind===kind&&askUi.doc.page===page){askUi.doc.turn=turn;renderDocBar();drawStudioRegions();then?.();return}
 askUi.doc={kind,page,turn};
 swapImage(docImage(kind,page,1800),`${DOCS[kind].title}, page ${page}`,then);
}
function showDrawing(then=null){
 if(!askUi.doc){then?.();return}
 askUi.doc=null;
 const s=project.pages[currentPage-1];
 swapImage(imageUrl(currentPage,2300),`${s.title}, page ${currentPage}`,then);
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
// Plain answer text: bullet and numbered lines become lists, short "Title:" lines become
// headings, and [Spec p.N] or [Cost p.N] tags open that reference page. Conflicts and gaps stand out.
function formatAnswer(text,turn=null,turnData=null){
 const cite=html=>html.replace(/\[(Spec|Cost)\s+pp?\.?\s*(\d{1,4})(?:\s*[–-]\s*(\d{1,4}))?\]/gi,(match,tag,first,last)=>{
  const kind=tag.toLowerCase()==='cost'?'cost':'spec',doc=DOCS[kind],current=projectDoc(kind);
  const page=Number(first),label=`${doc.cite} p.${first}${last?'–'+last:''}`;
  const open=current&&docCurrent(kind,turnData)&&page>=1&&page<=current.page_count;
  return open
   ?`<button type="button" class="cite" data-action="doc-page" data-doc="${kind}" data-page="${page}" data-turn="${turn}" aria-label="Open ${doc.lower} page ${page}">${ICON[doc.icon]}${label}</button>`
   :`<span class="cite is-static">${label}</span>`;
 });
 const sections=[{title:'',parts:[]}];let list=null,para=[];
 const add=html=>sections.at(-1).parts.push(html);
 const flushPara=()=>{if(para.length)add(`<p>${para.join('<br>')}</p>`);para=[]};
 const flushList=()=>{if(list)add(`<${list.tag}>${list.items.join('')}</${list.tag}>`);list=null};
 for(const raw of String(text).split('\n')){
  const line=raw.trim(),item=line.match(/^(?:[•*–-]\s+|(\d+)[.)]\s+)(.+)$/);
  if(!line){flushPara();flushList();continue}
  if(!item&&/^[A-Z][^.!?:]{1,46}:$/.test(line)&&line.split(/\s+/).length<=5){flushPara();flushList();sections.push({title:line.slice(0,-1),parts:[]});continue}
  if(!item){flushList();para.push(cite(esc(line)));continue}
  const tag=item[1]?'ol':'ul';flushPara();
  if(list?.tag!==tag){flushList();list={tag,items:[]}}
  list.items.push(`<li>${cite(esc(item[2]))}</li>`);
 }
 flushPara();flushList();
 const formatted=sections.map(({title,parts})=>{
  const body=(title?`<h4>${cite(esc(title))}</h4>`:'')+parts.join('');
  if(/^conflicts?\b/i.test(title))return `<div class="prose-callout is-alert">${body}</div>`;
  if(/^not covered\b/i.test(title))return `<div class="prose-callout is-note">${body}</div>`;
  return body;
 }).join('');
 return typeof tenderInlineCitations==='function'?tenderInlineCitations(formatted,turn):formatted;
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
 const spec=projectSpec();
 renderDocBar();
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
  <li>This drawing, matching pages from your reference PDFs when available, and relevant tender rows when linked are sent to the AI. Other drawings are never used, even if this one mentions them.</li>
  ${typeof projectTender==='function'&&projectTender()?'<li>Your tender summary is included. Review matches in the sidebar to confirm uncertain relationships. Tender citations open the original row; quantities belong to tender rows, not automatically to this drawing.</li>':''}
  ${DOC_KINDS.filter(projectDoc).map(kind=>`<li>Your ${DOCS[kind].lower} <b>${esc(projectDoc(kind).filename)}</b> is linked. For each question, this computer finds the pages that match the codes on this drawing (like FF-06) and the words you use, and sends only those.</li>
  <li>Choose a card under <b>${DOCS[kind].refsTitle}</b>, or a <b>${DOCS[kind].cite} p.</b> tag, to read that page on the left.</li>`).join('')}
  ${DOC_KINDS.some(projectDoc)?'<li>Answers list <b>Conflicts to resolve</b> where the documents disagree, and measurements that could not be found in them are flagged under <b>Check before use</b>. Always confirm with the designer before building.</li>':''}
  ${DOC_KINDS.filter(k=>!projectDoc(k)).map(kind=>`<li>No ${DOCS[kind].lower} is added to this project yet. Add it in the sidebar, under the project name, and every answer will use it too.</li>`).join('')}
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
  if(state.busy)html+=`<article class="qa">${questionHeading(state.pending)}${streamingBlock(state)}</article>`;
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
 const specOn=!!projectSpec(),costOn=!!projectCost();
 const prompts=[['Explain this drawing in simple words.','layout'],
  costOn?['What do the items on this sheet cost?','receipt']:['What dimensions are shown?','ruler'],
  specOn?['How do I install the items shown here?','book']:['What work is marked on this sheet?','pencil'],
  ['Summarize the notes on this sheet.','notes']];
 return `<div class="hero">
 <span class="hero-icon">${ICON.spark}</span>
 <h2>What would you like to know?</h2>
 <p>Ask in your own words. I read this drawing${specOn?', matching specification pages':''}${costOn?', matching cost breakdown pages':''}${typeof projectTender==='function'&&projectTender()?', and relevant tender summary rows':''}, and I’ll point to the sources.</p>
 <h3 class="visually-hidden">Suggested questions</h3>
 <div class="suggestions">${prompts.map(([q,icon])=>`<button type="button" data-action="prompt" data-prompt="${esc(q)}"><span class="suggestion-icon">${ICON[icon]}</span><span>${esc(q)}</span></button>`).join('')}</div>
 <p class="hero-note">Choosing one only fills in the question box. Nothing is sent until you press Ask.</p>
</div>`;
}
function answerBlock(state,i,question,locked){
 const t=state.turns[i],n=answerNumber(i),owner=highlightOwner(state,i),own=owner===i,color=replyColor(state,owner);
 const sources=state.turns[owner]?.sources||[],placed=sources.map((s,k)=>[s,k]).filter(([s])=>hasBox(s)),unplaced=sources.filter(s=>!hasBox(s));
 const shown=state.selected==null||state.selected.includes(i),dims=drawingDims(),usageOpen=askUi.usage.has(i);
 const source=state.turns[owner],unverified=source?.unverified||[];
 const docSection=kind=>{
  const doc=DOCS[kind],refs=doc.refs(source),open=docCurrent(kind,source);
  if(!refs.length)return '';
  const card=(r,k)=>{
   const inner=`<span class="spec-thumb">${open?`<img src="${docImage(kind,r.page,360)}" alt="" loading="lazy">`:ICON[doc.icon]}</span>
   <span class="spec-text"><span class="spec-meta">${r.code?`<b>${esc(r.code)}</b>`:''}<span>Page ${r.page}</span></span><strong>${esc(r.title)}</strong>${r.quote?`<q>${esc(r.quote)}</q>`:''}${open&&r.quote&&!r.verified?'<small class="spec-note">These exact words weren’t found on the page. Please check the page itself.</small>':''}</span>`;
   return open?`<button type="button" class="spec-ref" data-action="doc-ref" data-doc="${kind}" data-turn="${owner}" data-ref="${k}" aria-label="Open ${doc.lower} page ${r.page}: ${esc(r.title)}">${inner}${ICON.arrow}</button>`:`<div class="spec-ref is-static">${inner}</div>`;
  };
  const note=open?`Choose one to read the page${own?'':` · same pages as answer ${answerNumber(owner)}`}`:projectDoc(kind)?doc.refsChanged:doc.refsNone;
  return `<section class="spec-refs is-${kind}"><div class="places-head"><h3>${doc.refsTitle}</h3><p>${note}</p></div><div class="spec-list">${refs.map(card).join('')}</div></section>`;
 };
 const card=([s,k])=>{const crop=cropStyle(s.box,dims.w,dims.h);return `<button type="button" class="place" data-action="locate" data-turn="${owner}" data-source="${k}" data-region-ref="${regionKey(s.box)}" style="--c:${color}">
  <span class="place-crop"><img src="${imageUrl(currentPage,2300)}" alt="" loading="lazy" style="${crop}"></span>
  <span class="place-text"><strong>${esc(s.label)}</strong><small>${kindLabel(s)}</small></span></button>`};
 return `<article class="qa" aria-label="Answer ${n}">
 ${question?questionHeading(question):''}
 ${assistantLine(`Answer ${n}`)}
 ${t.cached?`<p class="qa-free">${ICON.check}Saved answer reused, no extra cost</p>`:''}
 <div class="prose">${formatAnswer(t.content,owner,source)}</div>
 ${unverified.length?`<p class="qa-check">${ICON.alert}<span><b>Check before use:</b> ${unverified.map(esc).join(', ')} ${unverified.length===1?'was':'were'} not found in the document text that was read.</span></p>`:''}
 ${placed.length?`<section class="places"><div class="places-head"><h3>Where to look</h3><p>Choose one to find it on the drawing${own?'':` · same places as answer ${answerNumber(owner)}`}</p></div><div class="places-grid">${placed.map(card).join('')}</div></section>`:''}
 ${DOC_KINDS.map(docSection).join('')}
 ${typeof tenderCitationsHtml==='function'?tenderCitationsHtml(state.turns[owner],owner):''}
 ${unplaced.length?`<p class="qa-also">Also mentioned, not outlined: ${[...new Set(unplaced.map(s=>s.label))].map(esc).join(', ')}</p>`:''}
 <div class="qa-foot">
  ${own&&sources.length?`<label class="switch"><input type="checkbox" role="switch" data-filter="${i}" ${shown?'checked':''} ${locked?'disabled':''}><span class="switch-track" aria-hidden="true"></span><span>Show on drawing</span></label>
  <button type="button" class="swatch-button" data-action="palette" data-turn="${i}" aria-expanded="${askUi.palette===i}" aria-label="Outline color for answer ${n}" ${locked?'disabled':''}><span class="swatch" style="--c:${color}"></span>Color</button>`:''}
  <button type="button" class="link-button" data-action="usage" data-turn="${i}" aria-expanded="${usageOpen}">Cost ${ICON.chevron}</button>
 </div>
 ${own&&askUi.palette===i?`<div class="palette" role="group" aria-label="Outline color for answer ${n}">${HIGHLIGHT_COLORS.map(([c,name])=>`<button type="button" data-action="color" data-turn="${i}" data-color="${c}" aria-pressed="${c===color.toLowerCase()}" ${locked?'disabled':''}><span class="swatch" style="--c:${c}"></span>${name}</button>`).join('')}</div>`:''}
 ${usageOpen?`<div class="qa-usage">${t.cached?'<p>This reply reused a saved answer, so no new tokens were used.</p>':''}${DOC_KINDS.map(k=>t[k+'_pages']?.length?`<p>${DOCS[k].title} pages read for this answer: ${t[k+'_pages'].join(', ')}</p>`:'').join('')}${chatUsageHtml(t.usage)}</div>`:''}
</article>`;
}
function streamingBlock(state){
 return `<div data-stream-wait ${state.streamText?'hidden':''}>${thinkingBlock(state.pendingSpec)}</div><p data-stream-status class="muted" role="status">${esc(state.streamStatus||'Preparing documents…')}</p><div data-stream-answer style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(state.streamText||'')}</div>`;
}
async function requestSheetStream(url,body,onEvent){
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.detail||`Request failed (${response.status})`)}
 if(!response.body)throw new Error('Streaming is unavailable in this browser.');
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',result,completed=false;
 try{
  while(true){
   const {done,value}=await reader.read();
   buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
   let boundary;
   while((boundary=buffer.indexOf('\n\n'))!==-1){
    const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
    const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data)continue;
    const event=JSON.parse(data);
    if(event.event==='error')throw new Error(event.message);
    if(event.event==='done'){result=event.result;completed=true}
    else onEvent(event);
   }
   if(done)break;
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 if(!completed)throw new Error('The connection ended before the answer was confirmed. Reload this conversation to check whether it was saved before retrying.');
 return result;
}
const thinkingBlock=withDocs=>`<div class="thinking" role="status">${assistantLine(`Reading this drawing${withDocs?' and your reference PDFs':''}<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>`)}
 <div class="skeleton" aria-hidden="true"><i></i><i></i><i></i></div>
 <p class="muted">${withDocs?'This can take a few minutes: the drawing is checked against your documents before answering.':'This can take up to a minute.'} You can go back and keep browsing; the answer will be saved here.</p></div>`;
function choiceCard(choice,locked){
 return `<section class="notice" aria-labelledby="choiceTitle">
 <h3 id="choiceTitle">You’ve asked this before</h3>
 <p>${esc(choice.reason||'There is a saved answer, but the documents, material matches or conversation context changed. No AI request has been sent.')}</p>
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
 // Browser-only chats are new to the server, so they start from its first revision.
 for(const [key,state] of sheetChats)if(key.startsWith(pid+':')&&!saved[key.split(':')[1]]&&state.turns.length){state.revision=0;await persistConversation(key)}
 saveChats();
}
async function sendSheetQuestion(key,fresh=false,reuseTurn=null){
 const state=chatState(key),question=(state.draft||'').trim();if(state.busy||state.saving||!question)return;
 const pid=project.id,page=currentPage;
 Object.assign(state,{busy:true,error:'',failed:'',pending:question,pendingSpec:DOC_KINDS.some(projectDoc),streamText:'',streamStatus:'Preparing documents…',previousChoice:null,draft:''});askUi.palette=null;renderStudio();
 try{
  const result=await requestSheetStream(`/api/projects/${pid}/pages/${page}/chat/stream`,{question,fresh,reuse_turn:reuseTurn},event=>{
   if(event.event==='answer'){state.streamText=event.text;state.streamStatus='Writing answer… Citations appear when complete.'}
   if(event.event==='status')state.streamStatus=event.text;
   if(project?.id===pid&&currentPage===page&&askStudio.open){
    const answer=$s('[data-stream-answer]'),status=$s('[data-stream-status]'),wait=$s('[data-stream-wait]');
    if(answer)answer.textContent=state.streamText;
    if(status)status.textContent=state.streamStatus;
    if(wait)wait.hidden=!!state.streamText;
   }
  });
  if(result.needs_choice){state.previousChoice={...result,question};return}
  if(result.conversation){state.turns=result.conversation.turns;state.revision=result.conversation.revision}else state.turns.push({role:'user',content:question},{role:'assistant',content:result.answer,usage:result.usage||{},sources:result.sources||[]});state.updated=Date.now();state.saveStatus='Saved to project';saveChats();
 }catch(e){state.error=e.message;state.failed=question;if(!(state.draft||'').trim())state.draft=question}
 finally{state.busy=false;state.pending=null;state.streamText='';state.streamStatus='';if(project?.id===pid&&currentPage===page)renderStudio()}
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
  case 'locate':{const source=state.turns[turn]?.sources?.[Number(b.dataset.source)];showDrawing(()=>locateInStudio(source,replyColor(state,turn)));break}
  case 'doc-ref':{const kind=b.dataset.doc,ref=DOCS[kind].refs(state.turns[turn])[Number(b.dataset.ref)];if(ref)showDocPage(kind,ref.page,turn,()=>ref.boxes?.[0]&&locateInStudio({box:ref.boxes[0]},replyColor(state,turn)));break}
  case 'doc-page':showDocPage(b.dataset.doc,Number(b.dataset.page),Number.isInteger(turn)?turn:null);break;
  case 'doc-prev':showDocPage(askUi.doc.kind,askUi.doc.page-1,askUi.doc.turn);break;
  case 'doc-next':showDocPage(askUi.doc.kind,askUi.doc.page+1,askUi.doc.turn);break;
  case 'doc-browse':{const kind=b.dataset.doc;askUi.doc?.kind===kind?showDrawing():showDocPage(kind,askUi.lastPage[kind]);break}
  case 'show-drawing':showDrawing();break;
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
 if(!askUi.doc)askUi.drawDims=askUi.dims;
 applyStudioZoom(false);renderStudio();
 const next=askUi.afterLoad;askUi.afterLoad=null;next?.();
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
 askUi.help=false;askUi.doc=null;askUi.afterLoad=null;
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
