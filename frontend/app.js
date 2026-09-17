const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let project, config, route='overview', area=null, query='', level='', discipline='', viewType='', stageValue='', currentPage=1, zoom=100, projects=[];
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),7000)}
async function api(path,options={}){const r=await fetch(path,options);if(!r.ok){let e;try{e=await r.json()}catch{e={detail:r.statusText}}throw Error(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail))}return r.status===204?null:r.json()}
const base=()=>`/api/projects/${project.id}`;
const imageUrl=(p,w=600)=>`${base()}/pages/${p}/image?width=${w}`;
const linked=(s,id)=>s.areas.some(a=>a.area===id);
const review=s=>s.needs_review||(!s.reviewed&&s.areas.some(a=>a.review));
const areaSheets=id=>project.pages.filter(s=>linked(s,id));
const pretty=t=>t.length>130?t.slice(0,127)+'…':t;
const tag=t=>`<span class="tag">${esc(t)}</span>`;

async function loadProject(id){project=await api(`/api/projects/${id}`);if(typeof loadSavedChats==='function')await loadSavedChats(id);localStorage.setItem('atlas-project',id);$('#projectSelect').value=id;$('#exportLink').href=base()+'/export';route='overview';area=null;query='';level='';discipline='';viewType='';stageValue='';renderNav();render();}
function renderNav(){
 if(typeof renderChatHistory==='function')renderChatHistory();
 if(typeof renderSpecNav==='function')renderSpecNav();
 document.querySelector('[data-nav=review]').hidden=true;$('#navCount').textContent=project.page_count;$('#reviewCount').textContent=project.pages.filter(review).length;$('#areaCount').textContent=project.areas.length;
 const wings=[...new Set(project.areas.map(a=>a.wing||'Detected areas'))];
 $('#areaNav').innerHTML=wings.map(w=>`<div class="wing-label">${esc(w)}</div>`+project.areas.filter(a=>(a.wing||'Detected areas')===w).map(a=>`<button class="area-link ${area===a.id?'active':''}" data-area="${esc(a.id)}"><span class="area-code">${esc(a.id)}</span>${esc(a.label||a.kind||a.id)}<small>${areaSheets(a.id).length}</small></button>`).join('')).join('');
 document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',!area&&b.dataset.nav===route));
 $('#areaNav').querySelectorAll('[data-area]').forEach(b=>b.onclick=()=>navigate('area',b.dataset.area));
}
function navigate(next,id=null){route=next;area=id;query='';level='';discipline='';viewType='';stageValue='';renderNav();render();window.scrollTo(0,0)}
function heading(label,title,description,extra=''){return `<div class="page-heading"><div><span class="eyebrow">${esc(label)}</span><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${extra}</div>`}
function stats(){const systems=new Set(project.pages.map(p=>p.discipline).filter(d=>!['Register','Unclassified'].includes(d)));return `<div class="stats">${[['Total sheets',project.page_count,'Indexed from your source PDF','▤'],['Project areas',project.areas.length,'Linked across drawing stages','◫'],['Disciplines',systems.size,'Interiors & building services','⌁'],['Work stages',project.stages.length,'Explore the work sequence','◇']].map(([a,b,c,d])=>`<div class="stat"><div class="stat-label">${a}</div><div class="stat-value">${b}</div><div class="stat-sub">${c}</div><span class="stat-icon">${d}</span></div>`).join('')}</div>`}
function overview(){
 const p=project.overview_page;
 return heading('PROJECT DIRECTORY',project.name,project.description||'A clearer view of your project. From the overall plan to the smallest detail.',tag('◷  Tender drawing set'))+stats()+(typeof specPanelHtml==='function'?`<div class="overview-spec">${specPanelHtml()}</div>`:'')+
 `<div class="section-title"><div><h3>The big picture</h3><p>Select an area on the plan to explore its drawings.</p></div>${p?`<button class="text-button" data-page="${p}">Open source drawing ↗</button>`:''}</div>
 <div class="overview-layout"><div class="map-card"><div class="card-top"><strong>Project overview</strong><span>${p?'SOURCE · PAGE '+p:'NO OVERVIEW DETECTED'}</span></div><div class="map-surface">${p?`<div class="map-figure" style="max-width:${Math.round(500*project.pages[p-1].width/project.pages[p-1].height)}px"><img src="${imageUrl(p,1400)}" alt="Overall project demarcation plan">${project.hotspots.filter(h=>!h.page||h.page===p).map(h=>`<button class="hotspot" style="left:${h.x*100}%;top:${h.y*100}%" data-area="${esc(h.area)}" aria-label="Explore ${esc(h.area)}">${esc(h.area)}</button>`).join('')}</div>`:'<div class="empty"><h3>Explore the drawing set</h3><p>No overall plan was identified. Browse the discovered areas, disciplines and work stages.</p></div>'}</div><div class="map-bottom"><span>● ${project.hotspots.length?'AI area markers · approximate':'Source drawing'}</span><span>${project.areas.length} areas in this directory</span></div></div>
 <div class="guide-card"><div><span class="eyebrow">A CONNECTED DRAWING SET</span><h2>Less scrolling.<br>More understanding.</h2><p>Your project, organized around the spaces you’re working on.</p></div><div><div class="guide-step"><b>01</b> Find your project area</div><div class="guide-step"><b>02</b> Follow the work sequence</div><div class="guide-step"><b>03</b> Explore details & source sheets</div></div><div class="guide-footer">Shared details stay connected to every relevant area.</div></div></div>
 <div class="section-title"><div><h3>Explore project areas</h3><p>One place for each space. All its related drawings.</p></div><button class="text-button" data-go="drawings">View all drawings →</button></div>
 <div class="area-grid">${project.areas.map(a=>`<button class="area-card" data-area="${esc(a.id)}"><div class="area-card-head"><span class="area-code">${esc(a.id)}</span><span class="arrow">↗</span></div><h3>${esc(a.label||a.id)}</h3><p>${esc([a.wing,a.kind].filter(Boolean).join(' · ')||'Project area')}</p><div class="area-card-bottom"><span>${areaSheets(a.id).length} linked sheets</span><span>Explore area →</span></div></button>`).join('')}</div>
 <div class="source-note">${esc(project.warnings.join(' ')||'Generated from the uploaded PDF. Open any sheet to inspect its evidence or correct a relationship.')} <a href="${base()}/pdf#page=${p||1}" target="_blank" rel="noopener">View original PDF ↗</a></div>`;
}
function filters(){return `<div class="filters"><div class="search-box"><span>⌕</span><input id="searchInput" placeholder="Search titles, drawing numbers, notes…" aria-label="Search drawings" value="${esc(query)}"></div><select id="levelFilter" aria-label="Filter by level"><option value="">All levels</option>${[...new Set(project.pages.flatMap(s=>s.levels))].map(l=>`<option ${level===l?'selected':''}>${esc(l)}</option>`).join('')}</select><select id="disciplineFilter" aria-label="Filter by discipline"><option value="">All disciplines</option>${[...new Set(project.pages.map(p=>p.discipline))].sort().map(d=>`<option ${discipline===d?'selected':''}>${esc(d)}</option>`).join('')}</select><select id="viewFilter" aria-label="Filter by view"><option value="">All views</option>${[...new Set(project.pages.flatMap(s=>s.views))].map(v=>`<option ${viewType===v?'selected':''}>${esc(v)}</option>`).join('')}</select><select id="workStageFilter" aria-label="Filter by work stage"><option value="">All work stages</option>${project.stages.map(t=>`<option ${stageValue===t?'selected':''}>${esc(t)}</option>`).join('')}</select></div>`}
function filtered(list){return list.filter(s=>(!query||[s.title,s.number,s.text,...s.notes,...s.areas.map(a=>a.area)].join(' ').toLowerCase().includes(query.toLowerCase()))&&(!level||s.levels.includes(level))&&(!discipline||s.discipline===discipline)&&(!stageValue||s.stage===stageValue)&&(!viewType||s.views.some(v=>v.toLowerCase().includes(viewType.toLowerCase()))))}
function card(s){return `<button class="sheet-card" data-page="${s.page}"><div class="sheet-thumb"><img src="${imageUrl(s.page,560)}" loading="lazy" alt="Drawing preview, page ${s.page}"><span class="sheet-page">P. ${String(s.page).padStart(3,'0')}</span></div><div class="sheet-info"><span class="sheet-stage">${esc(s.stage)} · ${esc(s.discipline)}</span><h3>${esc(pretty(s.title))}</h3><div class="sheet-meta"><span>${esc(s.number||'Source page '+s.page)}</span><span class="${review(s)?'review-tag':''}">${s.reviewed?'✓ Reviewed':review(s)?'◇ Review':s.source.startsWith('AI')?'✧ AI generated':'Text indexed'}</span></div></div></button>`}
function empty(message='No drawings match these filters.'){return `<div class="empty"><h3>Nothing here yet</h3><p>${esc(message)}</p></div>`}
function listBody(){
 let list=project.pages;
 if(route==='area')list=list.filter(s=>linked(s,area));
 if(route==='services')list=list.filter(s=>s.is_service===true||(project.engine!=='ai-v2'&&!['Interior design','Register','Unclassified'].includes(s.discipline)));
 if(route==='review')list=list.filter(review);
 list=filtered(list);
 let html=`<div class="results-caption">${list.length} sheets${level?' · Explicitly tagged '+esc(level)+'; sheets with unknown levels are hidden.':''}</div>`;
 if(!list.length)return html+empty(route==='area'?'No area links match. Browse shared details or building services, then review a sheet to assign it here.':undefined);
 if(route==='area'){
  for(const stage of project.stages){const sheets=list.filter(s=>s.stage===stage);if(!sheets.length)continue;html+=`<section class="stage-section"><h3 class="stage-heading"><span>${String(project.stages.indexOf(stage)+1).padStart(2,'0')}</span>${esc(stage)}<small>${sheets.length} sheets</small></h3><div class="sheet-grid">${sheets.map(card).join('')}</div></section>`}
 }else html+=`<div class="sheet-grid">${list.map(card).join('')}</div>`;
 return html;
}
function render(){
 if(!project)return;
 $('#crumb').textContent=area||({overview:'Project overview',drawings:'All drawings',services:'Building services',review:'Review queue',chat:'Ask drawings'}[route]);
 if(route==='overview')$('#main').innerHTML=overview();
 else{
  let top='';
  if(route==='area'){
   const a=project.areas.find(a=>a.id===area);
   top=heading('PROJECT AREA',a.label||area,'Follow the work sequence, with shared typical drawings linked in context.')+`<div class="area-banner"><span class="area-code">${esc(area)}</span><div><h3>${esc(a.wing||a.label||'Project area')}</h3><p>${a.size?a.size+' m² · ':''}Definition source: page ${a.source_page||'—'} · ${areaSheets(area).length} linked sheets</p></div>${project.overview_page?`<button data-page="${project.overview_page}">Locate in overview ↗</button>`:''}</div><div class="tabs"><button class="active">Work sequence</button><button data-go="services">Building services ↗</button><button data-go="drawings">All shared details ↗</button></div>`;
  }else if(route==='services')top=heading('DISCIPLINE DIRECTORY','Building services','The service disciplines discovered in this PDF, organized by system.')+`<div class="source-note" style="margin:0 0 23px">Services are linked to project areas only where the AI found supporting evidence. System-wide and uncertain sheets remain available here without forced area assignments.</div>`;
  else if(route==='review')top=heading('QUALITY & TRACEABILITY','A second look, where it matters.','Review inferred area links, unreadable titles and source inconsistencies. Every decision stays attached to its sheet.');
  else if(route==='chat')top=heading('ASK DRAWINGS','Ask about a drawing.','Open any sheet and ask questions in your own words. Answers come only from that sheet.')+(typeof recentChatsSection==='function'?recentChatsSection():'');
  else top=heading('DRAWING REGISTER','The complete drawing set.','Search every sheet, open its source, and explore related details.');
  $('#main').innerHTML=top+filters()+'<div id="results">'+listBody()+'</div>';
  $('#searchInput').oninput=e=>{query=e.target.value;updateResults()};$('#levelFilter').onchange=e=>{level=e.target.value;updateResults()};$('#disciplineFilter').onchange=e=>{discipline=e.target.value;updateResults()};$('#viewFilter').onchange=e=>{viewType=e.target.value;updateResults()};$('#workStageFilter').onchange=e=>{stageValue=e.target.value;updateResults()};
 }
 bindMain();enhanceDirectory();
}
function updateResults(){$('#results').innerHTML=listBody();bindMain()}
function bindMain(){ $('#main').querySelectorAll('[data-area]').forEach(b=>b.onclick=()=>navigate('area',b.dataset.area));$('#main').querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>route==='chat'&&typeof openAskStudio==='function'?openAskStudio(+b.dataset.page):openPage(+b.dataset.page));$('#main').querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go)); }
function openPage(page){
 currentPage=page;zoom=100;$('#zoomReset').textContent='Fit';const s=project.pages[page-1];$('#viewerTitle').textContent=s.title;$('#viewerCode').textContent=s.number||s.discipline;$('#pageLabel').textContent=`${page} / ${project.page_count}`;$('#previousPage').disabled=page===1;$('#nextPage').disabled=page===project.page_count;$('#sourceLink').href=base()+'/pdf#page='+page;$('#drawingImage').style.width='100%';$('#drawingImage').src=imageUrl(page,2300);$('#drawingImage').alt=s.title+' — source page '+page;$('#drawingScroll').scrollTop=0;renderDetails(s);if(typeof mountSheetChat==='function')mountSheetChat();if(!$('#viewer').open)$('#viewer').showModal();
}
function renderDetails(s){
 const related=project.pages.filter(p=>p.page!==s.page&&s.references.includes(p.number));
 $('#drawingDetails').innerHTML=`<div class="detail-group"><span class="eyebrow">SHEET CONTEXT</span><h3>${esc(s.discipline)}</h3>${tag(s.stage)}${s.levels.map(tag).join('')}<p style="margin-top:12px">${esc(s.source)}${s.reviewed?' · Reviewed':''}</p>${s.views.length?'<div style="margin-top:10px">'+s.views.map(tag).join('')+'</div>':''}</div>
 <div class="detail-group"><h3>Connected areas</h3>${s.areas.length?s.areas.map(a=>`<p><strong>${esc(a.area)}</strong> · ${esc(a.basis)}</p>${(a.evidence||[]).map(e=>`<p class="evidence-link"><button data-related="${e.page}">Page ${e.page} ↗</button> ${esc(e.quote)}</p>`).join('')}`).join(''):'<p>No area relationship established. This may be a shared or system drawing.</p>'}</div>
 ${s.notes.length?`<div class="detail-group"><h3>Source notes</h3><ul>${s.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></div>`:''}
 ${related.length?`<div class="detail-group"><h3>Referenced detail sheets</h3><div class="view-links">${related.map(p=>`<button data-related="${p.page}" title="${esc(p.title)}">Page ${p.page} ↗</button>`).join('')}</div></div>`:''}
 <div class="detail-group"><details id="editDetails"><summary>Edit & review classification</summary><form id="editForm"><label for="editTitle">Drawing title</label><textarea id="editTitle" required maxlength="500">${esc(s.title)}</textarea><label for="editNumber">Drawing number</label><input id="editNumber" value="${esc(s.number)}" maxlength="150"><label for="editViews">Views (comma separated)</label><input id="editViews" value="${esc(s.views.join(', '))}"><label for="editDiscipline">Discipline</label><input id="editDiscipline" value="${esc(s.discipline)}" required maxlength="80"><label class="service-check"><input id="editService" type="checkbox" ${s.is_service?'checked':''}> Building / engineering service drawing</label><label for="editStage">Work stage</label><select id="editStage">${project.stages.map(t=>`<option ${t===s.stage?'selected':''}>${esc(t)}</option>`).join('')}</select><label for="editAreas">Area codes (comma separated)</label><input id="editAreas" value="${esc(s.areas.map(a=>a.area).join(', '))}" placeholder="Area names or codes, separated by commas"><label for="editLevels">Levels (comma separated)</label><input id="editLevels" value="${esc(s.levels.join(', '))}" placeholder="Levels as named in the PDF"><label for="editNote">Review note</label><textarea id="editNote" maxlength="2000" placeholder="Evidence for your change"></textarea><button type="submit" class="primary">Save as reviewed</button></form></details></div>
 <div class="detail-group"><details><summary>Extracted source text</summary><pre class="raw-text">${esc(s.text||'No text extracted. Use AI vision to read this page.')}</pre></details></div>`;
 $('#drawingDetails').querySelectorAll('[data-related]').forEach(b=>b.onclick=()=>openPage(+b.dataset.related));
 if($('#analyzeButton'))$('#analyzeButton').onclick=()=>analyze(s.page);$('#editForm').onsubmit=saveReview;bindSuggestion(s.ai_suggestion);
}
function suggestionHtml(s){return `<div class="suggestion"><h3>AI suggestion · unreviewed</h3><p><strong>${esc(s.title)}</strong></p><p>${esc(s.discipline)} · ${esc(s.stage)}</p><p>Areas: ${esc(s.areas.join(', ')||'Uncertain / shared')}</p><p>${esc(s.evidence)}</p><button id="useSuggestion">Copy to review form ↓</button></div>`}
function bindSuggestion(s){if(!s||!$('#useSuggestion'))return;$('#useSuggestion').onclick=()=>{$('#editDetails').open=true;$('#editTitle').value=s.title;$('#editNumber').value=s.number;$('#editViews').value=s.views.join(', ');$('#editDiscipline').value=s.discipline;if(![...$('#editStage').options].some(o=>o.value===s.stage))$('#editStage').add(new Option(s.stage,s.stage));$('#editStage').value=s.stage;$('#editAreas').value=s.areas.join(', ');$('#editLevels').value=s.levels.join(', ');$('#editNote').value='AI suggestion reviewed: '+s.evidence;$('#editDetails').scrollIntoView({behavior:'smooth'});}}
async function analyze(page){
 if(!config.ai_ready){$('#settings').showModal();return}
 const button=$('#analyzeButton');button.disabled=true;button.textContent='Analyzing this sheet…';const pid=project.id;
 try{const r=await api(`/api/projects/${pid}/pages/${page}/analyze`,{method:'POST'});if(project.id===pid){project.pages[page-1].ai_suggestion=r.suggestion;if(currentPage===page){$('#aiResult').innerHTML=suggestionHtml(r.suggestion);bindSuggestion(r.suggestion)}}toast('AI suggestion ready. Review it before saving.');}catch(e){toast(e.message)}finally{if(project.id===pid&&currentPage===page){button.disabled=false;button.textContent='✧ Analyze with AI'}}
}
async function saveReview(e){
 e.preventDefault();const button=e.submitter;button.disabled=true;
 const body={is_service:$('#editService').checked,number:$('#editNumber').value.trim(),views:$('#editViews').value.split(',').map(x=>x.trim()).filter(Boolean),title:$('#editTitle').value.trim(),discipline:$('#editDiscipline').value.trim(),stage:$('#editStage').value,areas:$('#editAreas').value.split(',').map(x=>x.trim()).filter(Boolean),levels:$('#editLevels').value.split(',').map(x=>x.trim()).filter(Boolean),note:$('#editNote').value.trim()};
 try{await api(base()+`/pages/${currentPage}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});project=await api(base());renderNav();render();openPage(currentPage);toast('Classification saved. Your directory is updated.')}catch(e){toast(e.message)}finally{button.disabled=false}
}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>project&&navigate(b.dataset.nav));$('.brand').onclick=e=>{e.preventDefault();showHome()};$('#projectSelect').onchange=e=>selectSavedProject(e.target.value);$('#settingsButton').onclick=()=>$('#settings').showModal();$('#uploadButton').onclick=()=>showHome();$('#fileInput').onchange=e=>importPDF(e.target.files[0]);$('#closeViewer').onclick=()=>$('#viewer').close();$('#previousPage').onclick=()=>currentPage>1&&openPage(currentPage-1);$('#nextPage').onclick=()=>currentPage<project.page_count&&openPage(currentPage+1);
function setZoom(z){zoom=Math.max(40,Math.min(400,z));$('#drawingImage').style.width=zoom+'%';$('#zoomReset').textContent=zoom===100?'Fit':zoom+'%';if(typeof drawHighlights==='function')requestAnimationFrame(drawHighlights)}
$('#zoomOut').onclick=()=>setZoom(zoom-25);$('#zoomIn').onclick=()=>setZoom(zoom+25);$('#zoomReset').onclick=()=>setZoom(100);

