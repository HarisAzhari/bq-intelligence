// Upload-first application lifecycle. All directory content comes from the API.
let watching=null,pollTimer=null,uploading=false;
const phases=[['extracting','Prepare the PDF','Save your original drawing set and its page numbers.'],['document','Build navigation from the whole PDF','One document analysis connects the areas, work stages and drawing pages. This can take several minutes; there is no per-sheet review queue.'],['publishing','Open your directory','Create your area buttons and connected drawing navigation.']];
const newButton=document.createElement('button');newButton.className='nav';newButton.innerHTML='<span>＋</span> New project';newButton.onclick=()=>showHome();$('.nav-main').prepend(newButton);

async function refreshConfig(){config=await api('/api/config');$('#modelName').textContent=config.model;$('#connectionModel').value=config.model;renderAiStatus();}
// The header names the model that answers questions, so it is never a guess which one is active.
function renderAiStatus(){
 const status=$('#aiStatus');if(!status)return;
 status.classList.toggle('is-offline',!config.ai_ready);
 status.textContent=config.ai_ready?config.model:'AI connection needed';
 status.title=config.ai_ready?`Active OpenRouter model: ${config.model}`:'Add an OpenRouter key in AI settings.';
}
async function refreshProjects(){const r=await api('/api/projects');projects=r.projects;$('#projectSelect').innerHTML='<option value="">New PDF…</option>'+projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.engine==='legacy'?' · legacy prototype':''}</option>`).join('');}
async function init(){try{await refreshConfig();await refreshProjects();showHome();}catch(e){$('#main').innerHTML=`<div class="empty"><h3>Couldn’t connect to the workspace</h3><p>${esc(e.message)}</p><button id="retryHome">Try again</button></div>`;$('#retryHome').onclick=init;}}
function resetWorkspace(){project=null;area=null;route='home';watching=null;clearTimeout(pollTimer);$('#projectSelect').value='';$('#areaNav').innerHTML='<div class="nav-placeholder">Your PDF’s areas will appear here after generation.</div>';$('#areaCount').textContent='';$('#navCount').textContent='—';$('#reviewCount').textContent='—';$('#exportLink').hidden=true;$('#crumb').textContent='New project';document.querySelectorAll('[data-nav]').forEach(b=>b.classList.remove('active'));if(typeof renderSpecNav==='function')renderSpecNav();}
function statusLabel(p){return p.generation_complete?'Directory ready':({ready_to_generate:'Ready for confirmation',awaiting_key:config.ai_ready?'Ready to generate':'Waiting for AI connection',queued:'Queued',running:'AI is processing',failed:'Needs attention',paused:'Paused',interrupted:'Ready to resume'}[p.job?.status]||'Source PDF saved');}
function statusTone(status,complete=false){return complete?'success':status==='failed'?'error':['paused','interrupted','awaiting_key','ready_to_generate'].includes(status)?'warning':status==='running'||status==='queued'?'running':'neutral'}
function durationText(state={}){
 let seconds=state.duration_seconds;
 if(seconds==null&&state.started_at&&!state.finished_at)seconds=Math.max(0,(Date.now()-Date.parse(state.started_at))/1000);
 if(seconds==null||!Number.isFinite(Number(seconds)))return '';
 seconds=Math.round(Number(seconds));const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),secs=seconds%60;
 return [hours&&hours+'h',minutes&&minutes+'m',(!hours&&(!minutes||secs))&&secs+'s'].filter(Boolean).join(' ');
}
function usageHtml(metrics={}){
 const parts=[];
 if(metrics.input_tokens!=null)parts.push(`Input: <strong>${Number(metrics.input_tokens).toLocaleString()}</strong>`);
 if(metrics.output_tokens!=null)parts.push(`Output: <strong>${Number(metrics.output_tokens).toLocaleString()}</strong>`);
 if(metrics.tokens!=null)parts.push(`Total: <strong>${Number(metrics.tokens).toLocaleString()}</strong>`);
 if(metrics.reported_cost_usd!=null)parts.push(`Cost: <strong>$${Number(metrics.reported_cost_usd).toFixed(4)}</strong>`);
 return parts.join('<span>·</span>');
}
function usageBreakdownHtml(metrics={},pageCount){
 if(metrics.input_cost_usd==null||metrics.output_cost_usd==null)return usageHtml(metrics);
 const money=value=>value==null?'—':'$'+Number(value).toFixed(6);
 const cache=metrics.cache_write_tokens?` · ${Number(metrics.cache_write_tokens).toLocaleString()} cache-write tokens`:metrics.cached_tokens?` · ${Number(metrics.cached_tokens).toLocaleString()} cached tokens`:'';
 return `<div class="billing-breakdown"><div class="billing-row"><span>Input${cache}</span><strong>${Number(metrics.input_tokens||0).toLocaleString()} tok</strong><b>${money(metrics.input_cost_usd)}</b></div>
 <div class="billing-row"><span>Output</span><strong>${Number(metrics.output_tokens||0).toLocaleString()} tok</strong><b>${money(metrics.output_cost_usd)}</b></div>
 ${metrics.pdf_parser_cost_usd!=null?`<div class="billing-row"><span>PDF parsing${pageCount?' · '+pageCount+' pages':''}</span><strong></strong><b>${money(metrics.pdf_parser_cost_usd)}</b></div>`:''}
 <div class="billing-row total"><span>Total reported by OpenRouter</span><strong>${Number(metrics.tokens||0).toLocaleString()} tok</strong><b>${money(metrics.reported_cost_usd)}</b></div></div>`;
}
function showHome(){
 resetWorkspace();
 const saved=projects.filter(p=>p.engine==='ai-v2');const legacy=projects.filter(p=>p.engine!=='ai-v2');
 $('#main').innerHTML=`<section class="upload-hero"><span class="eyebrow">YOUR DRAWINGS, UNDERSTOOD</span><h1>A whole drawing set.<br>A clear way through it.</h1><p>Drop in a PDF. It will be prepared locally, then you choose the AI model<br class="desktop-break"> and confirm before any paid generation begins.</p><div id="dropZone" class="drop-zone" tabindex="0" role="button" aria-label="Choose a drawing PDF"><span class="upload-symbol">▤<i>＋</i></span><h2>Start with your PDF</h2><p>Drag a drawing set here, or <strong>browse files</strong></p><span class="file-limits">PDF · up to 150 MB · 500 pages</span></div><div class="upload-note"><span class="${config.ai_ready?'connected-dot':'pending-dot'}">●</span>${config.ai_ready?'AI connected · Generation waits for your confirmation.':'Upload now. Connect a real AI key before confirming generation.'}<button id="homeConnection">${config.ai_ready?'AI settings':'Connect AI ↗'}</button></div><p class="privacy-line">Uploading only saves and prepares the PDF locally. Nothing is sent to OpenRouter until you select Generate directory.</p></section>
 <div class="how-grid"><article><b>01</b><h3>Discover the project</h3><p>Areas, floors and disciplines come from your PDF’s content.</p></article><article><b>02</b><h3>Connect the details</h3><p>Layouts, elevations and shared sheets find their place in the directory.</p></article><article><b>03</b><h3>Explore with context</h3><p>Move from the overall plan to a space, a work stage, and its source drawings.</p></article></div>
 ${saved.length?`<div class="section-title"><div><h3>Your projects</h3><p>Pick up a saved directory or restart an unfinished PDF.</p></div><button class="text-button" id="refreshSaved">Refresh ↻</button></div><div class="saved-grid">${saved.map(p=>`<div class="saved-project-wrap status-${statusTone(p.job?.status,p.generation_complete)}"><button class="saved-project" data-saved="${esc(p.id)}"><span class="saved-icon">▤</span><div><h3>${esc(p.name)}</h3><p>${esc(p.filename)}</p><small>${p.page_count||'…'} pages${durationText(p.job)?' · '+durationText(p.job):''}</small><span class="project-status">${esc(statusLabel(p))}</span></div><span>↗</span></button><button class="delete-project" data-delete="${esc(p.id)}" data-name="${esc(p.name)}" aria-label="Delete ${esc(p.name)}">Delete</button></div>`).join('')}</div>`:''}
 ${legacy.length?`<details class="legacy-projects"><summary>Previous manual prototype (${legacy.length})</summary><p>These directories were prepared before automatic ingestion. They are preserved for reference; import their PDF again to generate a new directory with AI.</p>${legacy.map(p=>`<button data-legacy="${esc(p.id)}">${esc(p.name)} ↗</button>`).join('')}</details>`:''}`;
 const drop=$('#dropZone');drop.onclick=()=>$('#fileInput').click();drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#fileInput').click()}};drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging')};drop.ondragleave=()=>drop.classList.remove('dragging');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');if(e.dataTransfer.files.length!==1){toast('Choose one PDF drawing set at a time.');return}importPDF(e.dataTransfer.files[0]);};
 $('#homeConnection').onclick=()=>$('#settings').showModal();$('#main').querySelectorAll('[data-saved]').forEach(b=>b.onclick=()=>selectSavedProject(b.dataset.saved));$('#main').querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteProject(b.dataset.delete,b.dataset.name));$('#main').querySelectorAll('[data-legacy]').forEach(b=>b.onclick=()=>openDirectory(b.dataset.legacy));if($('#refreshSaved'))$('#refreshSaved').onclick=async()=>{await refreshProjects();showHome()};
}
async function selectSavedProject(id){if(!id){showHome();return}const p=projects.find(p=>p.id===id);if(p&&(p.generation_complete||p.engine!=='ai-v2'))await openDirectory(id);else showProgress(id);}
async function deleteProject(id,name){
 if(!confirm(`Delete "${name}" and its locally saved PDF, previews, AI responses, and edits? This cannot be undone.`))return;
 try{await api('/api/projects/'+id,{method:'DELETE'});if(localStorage.getItem('atlas-project')===id)localStorage.removeItem('atlas-project');await refreshProjects();showHome();toast('Project deleted.')}catch(e){toast(e.message)}
}
async function openDirectory(id){watching=null;clearTimeout(pollTimer);$('#exportLink').hidden=false;await loadProject(id);}
function enhanceDirectory(){
 if(!project)return;
 $('#exportLink').hidden=false;
 const main=$('#main');
 if(project.engine!=='ai-v2'){const banner=document.createElement('div');banner.className='source-note';banner.style.margin='0 0 22px';banner.textContent='Legacy manual prototype — this directory was not generated by the new ingestion engine. Import the PDF again for automatic discovery.';main.prepend(banner);}
 else if(!project.generation_complete){const banner=document.createElement('div');banner.className='source-note generation-summary warning';banner.style.margin='0 0 22px';banner.innerHTML='<strong>Generation unfinished</strong><p>Source pages only. The AI directory did not complete.</p><button id="backToProcessing">Return to processing →</button>';main.prepend(banner);$('#backToProcessing').onclick=()=>showProgress(project.id);}
 else{const metrics=project.ai_metrics||{};const elapsed=durationText(project.job);const banner=document.createElement('div');banner.className='generation-summary success';banner.innerHTML=`<div><strong>✓ AI generation completed</strong><p>${esc(project.model||'OpenRouter model')}${elapsed?' · Processed in '+elapsed:''}</p></div><div class="usage-metrics">${usageBreakdownHtml(metrics,project.page_count)||'Usage details were not reported for this run.'}</div>`;main.prepend(banner);}
 if(route==='overview'&&project.overview_pages?.length>1){const label=document.createElement('label');label.className='overview-picker';label.innerHTML=`Overview sheet <select aria-label="Choose overview sheet">${project.overview_pages.map(p=>`<option value="${p}" ${p===project.overview_page?'selected':''}>Page ${p} · ${esc(pretty(project.pages[p-1].title))}</option>`).join('')}</select>`;$('.map-card').before(label);label.querySelector('select').onchange=e=>{project.overview_page=Number(e.target.value);render()};}

}
async function importPDF(file){
 if(!file||uploading)return;if(!file.name.toLowerCase().endsWith('.pdf')){toast('Choose a PDF drawing set.');return}if(file.size>150*1024*1024){toast('Maximum PDF size is 150 MB.');return}
 uploading=true;resetWorkspace();$('#main').innerHTML=heading('NEW PROJECT','Uploading your drawing set…',file.name)+'<div class="uploading-bar"></div><p class="privacy-line">Keep this page open while the file uploads.</p>';
 try{const data=new FormData();data.append('file',file);const r=await api('/api/projects',{method:'POST',body:data});await refreshProjects();showProgress(r.id);}catch(e){toast(e.message);showHome()}finally{uploading=false;$('#fileInput').value=''}
}
function showProgress(id){resetWorkspace();watching=id;$('#projectSelect').value=id;$('#crumb').textContent='Generating directory';pollProgress(id);}
async function pollProgress(id){
 clearTimeout(pollTimer);if(watching!==id)return;
 try{
  const state=await api('/api/jobs/'+id);if(watching!==id)return;
  if(state.status==='complete'){await refreshProjects();await openDirectory(id);toast('Your AI-generated directory is ready.');return}
  renderProgress(id,state);
  if(['running','queued'].includes(state.status))pollTimer=setTimeout(()=>pollProgress(id),1800);
 }catch(e){if(watching!==id)return;$('#main').innerHTML=heading('PROCESSING','The connection was interrupted.','Your completed steps remain saved. Reconnect to check progress.')+`<button id="retryProgress">Check again</button><p class="source-note">${esc(e.message)}</p>`;$('#retryProgress').onclick=()=>pollProgress(id);}
}
function renderProgress(id,state){
 const waiting=['awaiting_key','ready_to_generate'].includes(state.status);const phase=waiting?1:Math.max(0,phases.findIndex(x=>x[0]===state.phase));const running=['running','queued'].includes(state.status);const stopped=!running&&!waiting;
 const tone=statusTone(state.status);
 const title=waiting?'Your PDF is ready for AI.':state.status==='failed'?'Generation failed.':stopped?'Generation stopped.':'Building your project navigation.';
 const subtitle=waiting?(config.ai_ready?'Confirm the active model, then click Generate directory to start the paid request.':'Save your OpenRouter connection, then click Generate directory to start.'):state.filename||'Discovering the structure of your drawing set.';
 const pct=waiting?0:state.total?Math.round(state.done/state.total*100):0;
 const pageCount=projects.find(p=>p.id===id)?.page_count;
 const elapsed=durationText(state);
 $('#main').innerHTML=heading('NEW PROJECT · AI GENERATION',title,subtitle)+`<div class="processing-layout"><section class="processing-card status-${tone}"><div class="process-top"><span class="tag status-pill ${tone}">${esc(state.status.replace('_',' '))}</span><span>${elapsed?'Elapsed '+elapsed:state.current_page&&state.phase==='reading'?'Source page '+state.current_page:''}</span></div><h2>${waiting?(config.ai_ready?'Ready to generate':'Connect your drawing reader'):esc(phases[phase][1])}</h2><p class="${state.error?'generation-message':''}">${esc(state.error||phases[phase][2])}</p><div class="progress-track"><div style="width:${pct}%"></div></div><div class="progress-count">${waiting?(state.total||0)+' source pages saved · AI has not started':(state.done||0)+' / '+(state.total||'—')+' '+(state.phase==='reading'?'sheets':'steps')+' in this stage'+(running?' · '+pct+'%':'')}</div><div class="generation-actions">${waiting?'<button id="resumeJob" class="primary">Generate directory →</button><button id="connectForJob">AI settings</button>':running?'<button id="pauseJob">Pause after document response</button>':`<button id="resumeJob" class="primary">${state.status==='failed'?'Restart generation':'Resume generation'} →</button><button id="connectForJob">AI settings</button>`}${state.phase!=='extracting'?'<button id="viewSourcePages" class="text-button">View source pages ↗</button>':''}</div><div class="processing-footnote">Restart sends a new whole-PDF request when no valid cached result exists. This may incur another provider charge.</div></section><section class="process-steps">${phases.map(([key,name,desc],i)=>`<div class="process-step ${i<phase?'done':i===phase?'current':''}"><span>${i<phase?'✓':String(i+1).padStart(2,'0')}</span><div><strong>${name}</strong><p>${desc}</p></div></div>`).join('')}</section></div><div class="generation-summary ${tone}"><div><strong>${tone==='error'?'✕ Generation failed':tone==='warning'?'! Generation stopped':'AI generation status'}</strong><p>Model: ${esc(state.model||config.model)} · ${state.requests||0} completed response${state.requests===1?'':'s'}${elapsed?' · '+elapsed:''}</p></div><div class="usage-metrics">${usageBreakdownHtml(state,pageCount)||'No token usage was reported.'}</div></div>`;
 if($('#connectForJob'))$('#connectForJob').onclick=()=>$('#settings').showModal();
 if($('#resumeJob'))$('#resumeJob').onclick=async()=>{try{await refreshConfig();if(!config.ai_ready){$('#settings').showModal();return}await api(`/api/projects/${id}/generate`,{method:'POST'});pollProgress(id)}catch(e){toast(e.message)}};
 if($('#pauseJob'))$('#pauseJob').onclick=async()=>{try{await api(`/api/projects/${id}/pause`,{method:'POST'});toast('Pausing after the current request is saved.')}catch(e){toast(e.message)}};
 if($('#viewSourcePages'))$('#viewSourcePages').onclick=async()=>{try{await openDirectory(id);navigate('drawings')}catch(e){toast(e.message)}};
}
$('#connectionForm').onsubmit=async e=>{
 e.preventDefault();const button=e.submitter;button.disabled=true;$('#connectionStatus').textContent='Saving…';
 try{config=await api('/api/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:$('#connectionKey').value,model:$('#connectionModel').value.trim()})});$('#connectionKey').value='';await refreshConfig();$('#connectionStatus').textContent=config.ai_ready?'Connection saved. Provider access is checked when generation starts.':'Model saved. Add a real key to enable generation.';if(config.ai_ready){$('#settings').close();if(watching)pollProgress(watching);else if(!project){await refreshProjects();const pending=projects.find(p=>p.engine==='ai-v2'&&!p.generation_complete&&!['running','queued'].includes(p.job?.status));if(pending)showProgress(pending.id);else showHome();}toast('Connection saved. Click Generate directory to start.');}else if(!project&&!watching)showHome();}
 catch(e){$('#connectionStatus').textContent=e.message}finally{button.disabled=false}
};
init();
