// Tender rows share the existing project and chat state. Upload/review never calls AI.
const tenderInput=Object.assign(document.createElement('input'),{type:'file',accept:'.pdf,application/pdf',hidden:true});
document.body.append(tenderInput);
const tenderUi={busy:false,data:null,pid:null,filter:'all',search:'',offset:0};
const projectTender=()=>project?.tender||null;
const tenderCurrent=turn=>!!projectTender()&&turn?.tender_hash===projectTender().hash&&turn?.tender_context===projectTender().context_hash&&turn?.spec_hash===(projectSpec()?.hash||null);
const tenderDialog=document.createElement('dialog');
tenderDialog.id='tenderReview';tenderDialog.setAttribute('aria-label','Review tender material matches');document.body.append(tenderDialog);
const tenderSource=document.createElement('dialog');
tenderSource.id='tenderSource';tenderSource.setAttribute('aria-label','Tender summary source');document.body.append(tenderSource);

function renderTenderNav(){
 const panel=document.querySelector('#tenderPanel');if(panel)panel.outerHTML=tenderPanelHtml();
 let nav=document.querySelector('#tenderNav');
 if(!nav){nav=document.createElement('div');nav.id='tenderNav';nav.className='spec-nav';document.querySelector('#specNav').after(nav)}
 nav.hidden=!project;if(!project){nav.innerHTML='';return}
 const tender=projectTender();
 nav.innerHTML=`<div class="project-label">TENDER SUMMARY</div>${tenderUi.busy?'<p role="status">Reading tender summary locally…</p>':tender?`
 <div class="spec-nav-item"><span class="spec-nav-text"><strong title="${esc(tender.filename)}">${esc(tender.filename)}</strong><small>${tender.row_count} rows · ${tender.page_count} pages</small></span></div>
 <div class="spec-nav-actions"><button data-tender-action="review">Review matches</button><button data-tender-action="source">Open</button><button data-tender-action="upload">Replace</button><button data-tender-action="remove">Remove</button></div>`:
 '<button class="spec-nav-add" data-tender-action="upload">＋ Add tender summary PDF</button>'}`;
}

function tenderPanelHtml(){
 const tender=projectTender();
 return `<section id="tenderPanel" class="spec-panel"><div><h3>Tender summary</h3><p>${tenderUi.busy?'Reading your PDF locally…':tender?`${esc(tender.filename)} · ${tender.row_count} extracted rows`:'Add the third document to connect tender rows with drawing codes and specification materials.'}</p>${tender?.warnings.length?`<p>${tender.warnings.length} extraction warnings — check Review matches.</p>`:''}</div><div class="spec-panel-actions">${tender?'<button data-tender-action="review">Review matches</button><button data-tender-action="source">Open</button>':''}<button data-tender-action="upload" ${tenderUi.busy?'disabled':''}>${tender?'Replace':'Add tender summary PDF'}</button>${tender?'<button data-tender-action="remove">Remove</button>':''}</div></section>`;
}

async function refreshTenderState(){
 if(!project)return;
 const pid=project.id;
 try{const data=await api(`/api/projects/${pid}/tender`);if(project?.id!==pid)return;project.tender=data.tender;renderTenderNav();if(askStudio.open)renderStudio()}
 catch(e){toast(e.message)}
}

tenderInput.addEventListener('change',async()=>{
 const file=tenderInput.files[0];if(!file||!project||tenderUi.busy)return;
 const pid=project.id;tenderUi.busy=true;renderTenderNav();
 try{
  if(!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Choose a PDF file.');
  if(file.size>150*1024*1024)throw new Error('Maximum tender summary size is 150 MB.');
  const body=new FormData();body.append('file',file);
  const result=await api(`/api/projects/${pid}/tender`,{method:'POST',body});
  if(project?.id===pid){project.tender=result;toast(`Tender summary read: ${result.row_count} rows. Review the matches before asking questions.`);await openTenderReview()}
 }catch(e){toast(e.message)}finally{tenderUi.busy=false;tenderInput.value='';renderTenderNav();if(askStudio.open)renderStudio()}
});

async function openTenderReview(){
 if(!project)return;
 const pid=project.id;
 try{
  const data=await api(`/api/projects/${pid}/tender`);if(project?.id!==pid)return;
  project.tender=data.tender;tenderUi.data=data;tenderUi.pid=pid;tenderUi.offset=0;
  renderTenderReview();if(!tenderDialog.open)tenderDialog.showModal();renderTenderNav();
 }catch(e){toast(e.message)}
}

function renderTenderReview(){
 const data=tenderUi.data;if(!data?.tender)return;
 const counts={};for(const row of data.rows)counts[row.link.status]=(counts[row.link.status]||0)+1;
 tenderDialog.innerHTML=`<div class="tender-heading"><div><h2>Tender material matches</h2><p>${esc(data.tender.filename)} · ${data.rows.length} extracted rows</p></div><button data-tender-action="close" aria-label="Close match review">✕</button></div>
 <p class="tender-explain">Automatic links use a printed code and a compatible description. Other matches need your review. Compare the source row with the specification before confirming. A link identifies a material; it does not verify every requirement.</p>
 ${data.tender.warnings.length?`<details class="tender-warning"><summary>${data.tender.warnings.length} extraction warnings</summary><ul>${data.tender.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></details>`:''}
 ${!data.items.length?'<p class="tender-warning">Add a technical specification with coded materials to enable matching. Tender rows can still be read and cited on their own.</p>':''}
 <div class="tender-filters"><input id="tenderSearch" aria-label="Search tender rows" placeholder="Search descriptions, codes or row IDs" value="${esc(tenderUi.search)}"><select id="tenderFilter" aria-label="Filter match status">${['all','confirmed','suggested','ambiguous','conflict','unmatched'].map(s=>`<option value="${s}" ${s===tenderUi.filter?'selected':''}>${s==='all'?'All rows':s} (${s==='all'?data.rows.length:counts[s]||0})</option>`).join('')}</select></div>
 <div id="tenderRows"></div><div class="tender-pagination"><button data-tender-action="previous">Previous</button><span id="tenderRange"></span><button data-tender-action="next">Next</button></div><p id="tenderReviewStatus" role="status"></p>`;
 tenderDialog.querySelector('#tenderSearch').oninput=e=>{tenderUi.search=e.target.value;tenderUi.offset=0;renderTenderRows()};
 tenderDialog.querySelector('#tenderFilter').onchange=e=>{tenderUi.filter=e.target.value;tenderUi.offset=0;renderTenderRows()};
 renderTenderRows();
}

function filteredTenderRows(){
 return (tenderUi.data?.rows||[]).filter(r=>(tenderUi.filter==='all'||r.link.status===tenderUi.filter)&&`${r.id} ${r.text} ${r.link.codes.join(' ')}`.toLowerCase().includes(tenderUi.search.toLowerCase()));
}

function renderTenderRows(){
 const data=tenderUi.data,rows=filteredTenderRows();
 tenderUi.offset=Math.min(tenderUi.offset,Math.max(0,Math.ceil(rows.length/20)-1)*20);
 const shown=rows.slice(tenderUi.offset,tenderUi.offset+20);
 tenderDialog.querySelector('#tenderRows').innerHTML=shown.map(row=>{
  const selected=row.link.codes.length?row.link.codes:row.link.candidates.slice(0,1).map(c=>c.code);
  const values=['item','code','unit','quantity','rate','amount','location'].filter(k=>row.fields[k]).map(k=>`<span><b>${esc(k)}:</b> ${esc(row.fields[k])}</span>`).join('');
  return `<article class="tender-row" data-row="${row.id}"><div class="tender-row-title"><strong>${esc(row.id)} · page ${row.page}</strong><span class="tender-status status-${row.link.status}">${esc(row.link.status)}${row.link.reviewed?' · reviewed':''}</span><button data-tender-action="row-source" data-row="${row.id}">View source row</button></div>
  <p class="tender-description">${esc(row.fields.description)}</p><div class="tender-values">${values}</div>
  ${!row.structured?'<p class="tender-warning">Unstructured text block. Check the source; quantity and price columns have not been inferred.</p>':''}
  <p>${row.link.reasons.map(esc).join(' ')}</p>
  ${row.link.codes.length?`<p>Linked materials: <b>${row.link.codes.map(esc).join(', ')}</b></p>`:''}
  ${row.drawing_pages.length?`<p>Code text appears on drawing pages ${row.drawing_pages.join(', ')}. This may be a legend; it does not prove a plan location.</p>`:''}
  ${row.link.candidates.length?`<details><summary>Why these candidates?</summary><ul>${row.link.candidates.map(c=>`<li><b>${esc(c.code)}</b> ${esc(c.title)} — ${c.reasons.map(esc).join(' ')}${c.pages.length?` <a target="_blank" rel="noopener" href="/api/projects/${tenderUi.pid}/spec/pdf#page=${c.pages[0]}">Spec p.${c.pages[0]}</a>`:''}</li>`).join('')}</ul></details>`:''}
  <details class="tender-edit"><summary>${row.link.status==='confirmed'?'Change link':'Review / choose materials'}</summary>
  <label>Specification materials <small>Use Ctrl/Cmd to select several for a grouped row.</small><select multiple size="5" aria-label="Materials for ${row.id}">${data.items.map(item=>`<option value="${esc(item.code)}" ${selected.includes(item.code)?'selected':''}>${esc(item.code)} — ${esc(item.title||'Untitled')} (Spec p.${item.pages?.[0]||'?'})</option>`).join('')}</select></label>
  <p>Confirm only after checking the source. A grouped row retains one total quantity; it is not split between materials.</p>
  <div class="tender-actions"><button data-tender-action="confirm" data-row="${row.id}" ${!data.items.length?'disabled':''}>Confirm selected</button><button data-tender-action="unmatched" data-row="${row.id}">Leave unmatched</button><button data-tender-action="reset" data-row="${row.id}">Reset to automatic</button></div></details></article>`;
 }).join('')||'<p class="tender-empty">No rows match this filter.</p>';
 tenderDialog.querySelector('#tenderRange').textContent=rows.length?`${tenderUi.offset+1}–${Math.min(rows.length,tenderUi.offset+20)} of ${rows.length}`:'0 rows';
 tenderDialog.querySelector('[data-tender-action="previous"]').disabled=tenderUi.offset===0;
 tenderDialog.querySelector('[data-tender-action="next"]').disabled=tenderUi.offset+20>=rows.length;
}

async function saveTenderDecision(rowId,action,button){
 if(tenderUi.busy||project?.id!==tenderUi.pid)return;
 const card=button.closest('.tender-row'),codes=[...card.querySelector('select').selectedOptions].map(o=>o.value);
 if(action==='confirm'&&!codes.length){toast('Choose at least one specification material.');return}
 tenderUi.busy=true;tenderDialog.querySelectorAll('button').forEach(b=>b.disabled=true);
 try{
  await api(`/api/projects/${tenderUi.pid}/tender/rows/${rowId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,codes,context_hash:tenderUi.data.tender.context_hash})});
  const data=await api(`/api/projects/${tenderUi.pid}/tender`);
  if(project?.id!==tenderUi.pid)return;
  tenderUi.data=data;project.tender=data.tender;renderTenderReview();
  tenderDialog.querySelector('#tenderReviewStatus').textContent='Match saved. New answers will use the updated relationships.';
  if(askStudio.open)renderStudio();
 }catch(e){toast(e.message);tenderDialog.querySelector('#tenderReviewStatus').textContent=e.message}
 finally{tenderUi.busy=false;tenderDialog.querySelectorAll('button').forEach(b=>b.disabled=false);renderTenderRows();renderTenderNav()}
}

function showTenderSource(page,box=null){
 const tender=projectTender();if(!tender||!Number.isInteger(page)||page<1||page>tender.page_count)return;
 const pid=project.id,highlight=Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)?`<div class="tender-source-mark" style="left:${box[0]*100}%;top:${box[1]*100}%;width:${(box[2]-box[0])*100}%;height:${(box[3]-box[1])*100}%"></div>`:'';
 tenderSource.innerHTML=`<div class="tender-heading"><div><h2>Tender summary · page ${page}</h2><p>${esc(tender.filename)}</p></div><button data-tender-action="source-close" aria-label="Close tender source">✕</button></div><div class="tender-source-controls"><button data-tender-action="source-page" data-page="${page-1}" ${page===1?'disabled':''}>Previous</button><span>${page} / ${tender.page_count}</span><button data-tender-action="source-page" data-page="${page+1}" ${page===tender.page_count?'disabled':''}>Next</button><a href="/api/projects/${pid}/tender/pdf#page=${page}" target="_blank" rel="noopener">Original PDF ↗</a></div><div class="tender-source-scroll"><div class="tender-source-page"><img src="/api/projects/${pid}/tender/pages/${page}/image?version=${tender.hash}" alt="Tender summary page ${page}">${highlight}</div></div>`;
 tenderSource.querySelector('img').onerror=()=>{tenderSource.querySelector('.tender-source-scroll').textContent='Could not load this source. It may have been replaced. Close this view and reopen the current tender summary.'};
 if(!tenderSource.open)tenderSource.showModal();
}

function tenderCitationsHtml(turn,owner){
 const refs=turn?.tender_refs||[];if(!refs.length)return '';
 const current=tenderCurrent(turn);
 return `<section class="spec-refs"><div class="places-head"><h3>From the tender summary</h3><p>${current?'Choose a row to check the original page.':'Documents or material matches changed. These citations belong to an earlier answer.'}</p></div><div class="spec-list">${refs.map((r,i)=>{
  const content=`<span class="spec-text"><span class="spec-meta">${esc(r.row_id)} · Tender p.${r.page} · ${esc(r.status)}</span><strong>${esc(r.title)}</strong>${r.quote?`<q>${esc(r.quote)}</q>`:''}${r.quote&&!r.verified?'<small>Quote not verified against the extracted row; check the source.</small>':''}</span>`;
  return current?`<button class="spec-ref" data-tender-action="citation" data-turn="${owner}" data-ref="${i}">${content}</button>`:`<div class="spec-ref is-static">${content}</div>`;
 }).join('')}</div></section>`;
}

function tenderInlineCitations(html,owner){
 const turn=Number.isInteger(owner)&&project?chatState(chatKey()).turns[owner]:null;
 return html.replace(/\[Tender\s+(r\d+)\]/gi,(whole,id)=>{
  const i=(turn?.tender_refs||[]).findIndex(r=>r.row_id===id.toLowerCase());
  return i>=0&&tenderCurrent(turn)?`<button class="cite" data-tender-action="citation" data-turn="${owner}" data-ref="${i}">Tender ${esc(id)}</button>`:`<span class="cite is-static">Tender ${esc(id)}</span>`;
 });
}

document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-tender-action]');if(!button)return;
 const action=button.dataset.tenderAction;
 if(action==='close'){tenderDialog.close();return}
 if(action==='source-close'){tenderSource.close();return}
 if(!project)return;
 try{
  if(action==='upload'&&!tenderUi.busy)tenderInput.click();
  else if(action==='review')await openTenderReview();
  else if(action==='source')showTenderSource(1);
  else if(action==='source-page')showTenderSource(Number(button.dataset.page));
  else if(action==='row-source'){const row=tenderUi.data.rows.find(r=>r.id===button.dataset.row);if(row)showTenderSource(row.page,row.box)}
  else if(action==='previous'||action==='next'){tenderUi.offset+=action==='next'?20:-20;renderTenderRows()}
  else if(['confirm','unmatched','reset'].includes(action))await saveTenderDecision(button.dataset.row,action,button);
  else if(action==='citation'){
   const turn=chatState(chatKey()).turns[Number(button.dataset.turn)],ref=turn?.tender_refs?.[Number(button.dataset.ref)];
   if(ref&&tenderCurrent(turn))showTenderSource(ref.page,ref.box);
  }else if(action==='remove'&&!tenderUi.busy&&confirm('Remove the tender summary? Saved answers stay, but their tender citations become outdated.')){
   const pid=project.id;await api(`/api/projects/${pid}/tender`,{method:'DELETE'});
   if(project?.id===pid){project.tender=null;renderTenderNav();if(askStudio.open)renderStudio()}
  }
 }catch(error){toast(error.message)}
});
