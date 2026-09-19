// Saved AI BOMs and responsive job feedback. Merely viewing the page never starts AI.
Object.assign(procurement,{page:0,pageSize:20,supplierPage:0,supplierQuery:'',supplierStatus:'all',supplierCountry:'',supplierState:'',supplierSort:'material',expanded:new Set(),poll:null});
const procActive=j=>j&&['queued','running','cancelling'].includes(j.status);
const procElapsed=j=>{const end=j.finished_at?Date.parse(j.finished_at):Date.now();const n=Math.max(0,Math.floor((end-Date.parse(j.started_at||new Date()))/1000));return `${Math.floor(n/60)}m ${n%60}s`};

function procProgress(){
 return Object.entries(procurement.data?.jobs||{}).filter(([,j])=>j.status!=='idle').map(([kind,j])=>{
  const active=procActive(j),cost=j.usage?.reported_cost_usd;
  return `<section class="proc-job ${active?'active':''}" aria-live="polite"><div class="proc-job-top">${active?'<span class="proc-spinner" aria-hidden="true"></span>':'<span class="proc-job-symbol">'+(j.status==='complete'?'✓':'!')+'</span>'}<div><strong>${kind==='bom'?'AI Bill of Materials':'AI supplier search'} · ${esc(procLabel(j.status))}</strong><p>${esc(j.message||'Preparing…')}</p></div><span class="proc-job-time">${procElapsed(j)}</span></div>${active?`<div class="proc-runbar" role="progressbar" aria-label="${kind==='bom'?'BOM generation':'Materials searched'}" ${kind==='suppliers'&&j.total?`aria-valuenow="${j.done||0}" aria-valuemin="0" aria-valuemax="${j.total}"`:''}><span ${kind==='suppliers'&&j.total?`style="width:${Math.round(100*(j.done||0)/j.total)}%;animation:none"`:''}></span></div>`:''}<div class="proc-job-meta">${kind==='bom'?`<span>Stage: ${esc(procLabel(j.phase||'queued'))} · ${j.done||0}/${j.total||0} sections</span>${Object.entries(j.workers||{}).map(([id,w])=>`<span> · Worker ${esc(id)}: ${esc(w.status)}${w.section?' · section '+w.section:''}</span>`).join('')}`:`<span>${j.done||0} / ${j.total||0} materials · ${j.failed||0} failed · ${j.unavailable||0} no match · ${j.reused||0} reused</span>`}${active?`<span class="proc-pulse">Worker heartbeat ${j.heartbeat_at?Math.max(0,Math.floor((Date.now()-Date.parse(j.heartbeat_at))/1000)):0}s ago</span><button data-auto="cancel" data-kind="${kind}" ${j.status==='cancelling'?'disabled':''}>Cancel</button>`:''}${j.usage?.requests!==undefined?`<span> · ${j.usage.requests} AI requests · ${j.usage.tokens||0} tokens · ${cost==null?'Cost not reported':`USD ${Number(cost).toFixed(5)}`}</span>`:''}</div></section>`;
 }).join('');
}

async function renderProcurement(){
 const pid=project.id,token=++procurement.loading;
 clearTimeout(procurement.poll);
 if(procurement.pid!==pid){Object.assign(procurement,{pid,data:null,tab:'materials',page:0,supplierPage:0,search:'',filter:'all',supplierQuery:'',supplierStatus:'all',supplierCountry:'',supplierState:'',supplierSort:'material',expanded:new Set()});if(procDialog.open)procDialog.close()}
 if(!procurement.data)$('#main').innerHTML='<div class="proc-empty" role="status"><span class="proc-spinner"></span><h3>Loading saved Procurement workspace…</h3><p>This step does not call AI.</p></div>';
 try{const data=await api(`/api/projects/${pid}/procurement`);if(token!==procurement.loading||project?.id!==pid||route!=='procurement')return;procurement.data=data;drawProcurement();procSchedule()}
 catch(e){if(project?.id===pid&&route==='procurement'){$('#main').innerHTML=`<div class="proc-empty"><h3>Unable to load Procurement</h3><p>${esc(e.message)}</p><button data-auto="reload">Try again</button></div>`}}
};

function procSchedule(){
 clearTimeout(procurement.poll);
 if(route!=='procurement'||!Object.values(procurement.data.jobs||{}).some(procActive))return;
 const pid=procurement.pid;
 procurement.poll=setTimeout(async()=>{
  if(route!=='procurement'||project?.id!==pid)return;
  try{
   const jobs=await api(`/api/projects/${pid}/procurement/jobs`);
   if(project?.id!==pid||route!=='procurement')return;
   const changed=Object.entries(jobs).some(([k,v])=>v.status!==procurement.data.jobs[k]?.status||v.done!==procurement.data.jobs[k]?.done);
   procurement.data.jobs=jobs;
   if(changed){const data=await api(`/api/projects/${pid}/procurement`);if(project?.id!==pid||route!=='procurement')return;procurement.data=data;if(!procDialog.open){const focused=document.activeElement?.id;const selection=document.activeElement?.selectionStart;drawProcurement();if(focused&&document.getElementById(focused)){const input=document.getElementById(focused);input.focus();if(typeof selection==='number'&&input.setSelectionRange)input.setSelectionRange(selection,selection)}}}
   const panel=$('#procProgress');if(panel)panel.innerHTML=procProgress();procSchedule();
  }catch(e){const panel=$('#procProgress');if(panel)panel.innerHTML=`<div class="proc-warning">Progress connection interrupted: ${esc(e.message)}. Saved work may still be running. <button data-auto="reload">Reconnect</button></div>`}
 },1800);
}

function drawProcurement(){
 if(route!=='procurement'||project?.id!==procurement.pid)return;
 const d=procurement.data;
 $('#main').innerHTML=`<section class="procurement">${heading('AI PROCUREMENT','Your project. Ready to source.','A saved Bill of Materials, traceable evidence, and supplier results organized by material.','<button data-auto="reload">Refresh saved results ↻</button>')}<div id="procProgress">${procProgress()}</div>
 ${d.bom_stale?'<div class="proc-warning">The BOQ or extraction rules changed. Generate a current BOM before new supplier searches or purchases.</div>':''}
 <div class="proc-metrics">${[[d.items.length,'BOM materials'],[d.items.filter(i=>i.conflicts.length).length,'Need attention'],[Object.values(d.supplier_results||{}).filter(r=>r.current&&r.status==='complete').length,'With suppliers'],[d.orders.filter(o=>!['cancelled','delivered'].includes(o.status)).length,'Open orders']].map(([n,t])=>`<div class="proc-metric"><span>${t}</span><b>${n}</b></div>`).join('')}</div>
 <div class="proc-tabs" role="tablist">${[['materials','Materials BOM'],['discover','Find suppliers'],['quotes','Supplier quotes'],['cart',`Cart (${d.cart.length})`],['orders',`Orders (${d.orders.length})`]].map(([v,t])=>`<button role="tab" aria-selected="${procurement.tab===v}" class="${procurement.tab===v?'active':''}" data-auto-tab="${v}">${t}</button>`).join('')}</div>
 <div id="procContent">${procurement.tab==='materials'?procMaterials():procurement.tab==='discover'?procDiscovery():procurement.tab==='quotes'?procQuotes():procurement.tab==='cart'?procCart():procOrders()}</div></section>`;
 $('#main').querySelectorAll('[data-auto-tab],[data-proc-tab]').forEach(b=>b.onclick=()=>{procurement.tab=b.dataset.autoTab||b.dataset.procTab;drawProcurement()});
 const s=$('#procSearch');if(s)s.oninput=e=>{procurement.search=e.target.value;procurement.page=0;procRenderMaterialTable()};
 bindSupplierFilters();
}

function procMaterials(){
 const d=procurement.data,active=Object.values(d.jobs).some(procActive),estimate=d.estimate;
 return `<div class="proc-toolbar"><div><h3>${d.bom.partial?'Partial BOQ materials':d.bom.version?'Saved AI Bill of Materials':'Generate your Bill of Materials'}</h3><p class="proc-muted">${d.bom.version?`Generated ${esc(d.bom.created_at)} · ${esc(d.bom.model)} · ${esc(d.bom.coverage||'')}`:`${estimate.documents?esc(estimate.source_filename)+' · '+estimate.pages+' pages · '+estimate.pdf_mb+' MB':'Add the BOQ using Add tender summary PDF first.'} Designated BOQ only. One request per section; up to two workers.`}</p></div><button class="primary" data-auto="generate" ${active||!estimate.documents?'disabled':''}>${['failed','cancelled','interrupted'].includes(d.jobs.bom?.status)?'Resume AI BOM':d.bom.version?'Regenerate BOM':'Generate AI BOM'}</button></div>
 ${d.bom.partial?`<div class="proc-warning">Partial result: ${d.bom.completed_sections} of ${d.bom.section_count} sections saved. These materials are visible for review; purchasing remains disabled until generation finishes. Resume with Force unchecked to reuse saved work.</div>`:''}
 <p class="proc-muted">Extracts purchasable materials and assemblies from the designated BOQ, in BOQ order. Labour, preliminaries and totals are excluded. Work rates are not material purchase prices. Missing or unclear requirements need attention.</p>
 ${d.warnings.length?`<details class="proc-warning"><summary>${d.warnings.length} coverage notes</summary><ul>${d.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}
 ${d.items.length?`<div class="proc-toolbar"><input id="procSearch" aria-label="Search BOM" placeholder="Find a material or specification…" value="${esc(procurement.search)}"><a href="${procUrl()}/rfq" target="_blank" rel="noopener">Download quotation request ↗</a></div><div id="procMaterialTable">${procBOMTable()}</div>`:`<div class="proc-empty"><span class="${active?'proc-spinner':''}"></span><h3>${active?'AI is preparing the BOM':d.bom.version?'No purchasable materials were returned':estimate.documents?'Your BOQ is ready for AI':'Add your BOQ'}</h3><p>${active?'Progress and worker heartbeat are shown above. You can leave this page and return.':d.bom.version?'Review the coverage notes above.':'Generate once, then reopen the saved result without AI credits. Successful sections are reused when resuming.'}</p></div>`}
 ${d.bom_history.length?`<details class="proc-card"><summary>Saved BOM versions (${d.bom_history.length})</summary><p class="proc-muted">Restoring a saved version uses no AI credits. A version based on older documents is marked outdated.</p>${d.bom_history.slice().reverse().map(v=>`<p>${esc(v.created_at)} · ${esc(v.model)} · ${v.usage?.tokens||0} tokens <button data-auto="restore" data-version="${v.version}" ${active||v.version===d.bom.version?'disabled':''}>Restore</button></p>`).join('')}</details>`:''}`;
};

function procBOMTable(){
 const items=procurement.data.items.filter(i=>`${i.name} ${i.specification} ${i.codes.join(' ')}`.toLowerCase().includes(procurement.search.toLowerCase()));
 procurement.page=Math.max(0,Math.min(procurement.page,Math.ceil(items.length/procurement.pageSize)-1));
 return `<div class="proc-table-wrap"><table class="proc-table"><thead><tr><th>#</th><th>Material</th><th>Requirement</th><th>Budget</th><th>Evidence</th><th></th></tr></thead><tbody>${items.slice(procurement.page*procurement.pageSize,(procurement.page+1)*procurement.pageSize).map(i=>`<tr><td>${i.sequence||procurement.data.items.indexOf(i)+1}</td><td><strong>${esc(i.name)}</strong><small>${i.boq_item?'BOQ '+esc(i.boq_item):''}${i.boq_page?' · page '+i.boq_page:''}</small><small>${esc(i.codes.join(' · '))} · ${esc(i.category)}</small><small>${esc(i.specification)}</small></td><td>${i.quantity==null?'Unknown quantity':esc(i.quantity)} ${esc(i.unit)}<small>${esc(i.location||'Location not specified')}</small></td><td>${i.budget==null?'Unknown':procAmount(i.budget,esc(i.currency))}</td><td>${procBadge(i.status,i.conflicts.length?'warn':'good')}<small>${i.sources.length} citations · identity: ${esc(i.confidence_fields?.identity||'unknown')}</small></td><td><button data-auto="evidence" data-id="${i.id}">View evidence</button></td></tr>`).join('')||'<tr><td colspan="6">No matching materials.</td></tr>'}</tbody></table></div>${procPagination('materials',procurement.page,items.length)}`;
}
function procRenderMaterialTable(){const target=$('#procMaterialTable');if(target)target.innerHTML=procBOMTable()}
function procPagination(kind,page,total){return `<div class="proc-pagination"><span>${total?`${page*procurement.pageSize+1}–${Math.min(total,(page+1)*procurement.pageSize)} of ${total}`:'0 results'}</span><button data-auto="previous" data-list="${kind}" ${page===0?'disabled':''}>Previous</button><button data-auto="next" data-list="${kind}" ${(page+1)*procurement.pageSize>=total?'disabled':''}>Next</button></div>`}

function procReview(id){
 const i=procItem(id);
 procDialog.innerHTML=`<div class="proc-dialog-header"><h2>${esc(i.name)}</h2><button data-proc="close" aria-label="Close evidence">✕</button></div><p>${esc(i.specification)}</p><p class="proc-muted">${esc(i.quantity_basis||'')} ${esc(i.resolution||'')}</p><div>${Object.entries(i.confidence_fields||{}).map(([k,v])=>procBadge(k+': '+v)).join('')}</div>${i.conflicts.length?`<div class="proc-warning">${i.conflicts.map(esc).join('<br>')}</div>`:''}<h3>AI supplier filters</h3><p class="proc-muted">${esc(i.search_plan?.basis||'No filter basis available.')}<br>Location: ${esc(i.search_plan?.location||i.search_plan?.country||'Unrestricted')} · Company: ${esc(i.search_plan?.company||'Any supplier')} · Currency: ${esc(i.search_plan?.currency||'Not specified')}</p>${i.sources.map(s=>`<div class="proc-source"><a target="_blank" rel="noopener" href="${procUrl()}/source/${s.kind}/${s.hash}#page=${s.page}">${esc(s.filename)} · page ${s.page}</a> ${procBadge(s.verified?'Source verified':'Source unverified',s.verified?'good':'warn')}<small>${esc((s.fields||[]).join(', '))}</small><p>${esc(s.quote||s.text)}</p></div>`).join('')||'<p>No verified source references.</p>'}`;
 procDialog.showModal();
};

document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-auto]');if(!b||!project||project.id!==procurement.pid)return;
 const action=b.dataset.auto; b.disabled=true;
 try{
  if(action==='reload')await renderProcurement();
  else if(action==='evidence')procReview(b.dataset.id);
  else if(action==='generate'){
   const d=procurement.data;
   procShow(d.bom.version?'Regenerate AI BOM':'Generate AI BOM',`<p>Designated BOQ: ${esc(d.estimate.source_filename)} · ${d.estimate.pages} pages</p><p>Readable text is split only when needed. Each section uses one AI request, with at most two running together. There is no second AI pass or PDF parsing charge. Responses are saved before validation. Successful sections are reused, and uncertain entries are flagged for review. Leave Force unchecked to resume saved work.</p>`, '<label class="check wide"><input name="force" type="checkbox"> Force a fresh analysis, even if an identical saved result exists (uses additional credits)</label>','Start AI generation',async v=>{await api(procUrl()+'/bom/generate?force='+(v.force==='on'),{method:'POST'});const data=await api(procUrl());setTimeout(procSchedule,0);return data});
  }else if(action==='batch'){
   const count=procurement.data.items.filter(i=>i.search_ready).length;
   procShow('Find suppliers for the BOM',`<p>Search up to ${count} materials using AI-selected filters. Each uncached material can use one AI request and up to two web searches. This may use substantial credits for large BOMs. Completed results are saved per material.</p>`, '<label class="check wide"><input name="force" type="checkbox"> Refresh all supplier results, including saved matches (additional credits)</label>','Start supplier search',async v=>{await api(procUrl()+'/suppliers/batch?force='+(v.force==='on'),{method:'POST'});const data=await api(procUrl());setTimeout(procSchedule,0);return data});
  }else if(action==='cancel'){await api(procUrl()+`/jobs/${b.dataset.kind}/cancel`,{method:'POST'});await renderProcurement()}
  else if(action==='restore'){procurement.data=await api(procUrl()+`/bom/restore/${b.dataset.version}`,{method:'POST'});drawProcurement()}
  else if(action==='next'||action==='previous'){const key=b.dataset.list==='materials'?'page':'supplierPage';procurement[key]+=action==='next'?1:-1;if(key==='page')procRenderMaterialTable();else procRenderSupplierTable()}
  else if(action==='toggle-suppliers'){const id=b.dataset.id;procurement.expanded.has(id)?procurement.expanded.delete(id):procurement.expanded.add(id);procRenderSupplierTable()}
  else if(action==='lead-quote'){const r=procurement.data.supplier_results[b.dataset.id];procAddQuote(r.results[Number(b.dataset.index)],b.dataset.id)}
 }catch(err){toast(err.message)}finally{b.disabled=false}
});
procDialog.addEventListener('close',()=>{if(route==='procurement'&&procurement.data)drawProcurement()});
