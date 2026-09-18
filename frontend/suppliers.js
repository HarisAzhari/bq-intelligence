// One row per BOM material; full search history is never stacked into the page.
function procDiscovery(){
 const d=procurement.data,active=Object.values(d.jobs||{}).some(procActive),records=Object.values(d.supplier_results||{}).filter(r=>r.current);
 const leads=records.flatMap(r=>r.results||[]),countries=[...new Set(leads.map(l=>l.country).filter(Boolean))].sort(),states=[...new Set(leads.filter(l=>!procurement.supplierCountry||l.country===procurement.supplierCountry).map(l=>l.state).filter(Boolean))].sort();
 return `<div class="proc-toolbar"><div><h3>Suppliers, organized by material</h3><p class="proc-muted">AI chooses search filters from the BOM. These display filters only browse saved results and use no AI credits.</p></div><button class="primary" data-auto="batch" ${active||!d.bom.version||d.bom_stale?'disabled':''}>Find / resume suppliers</button></div>
 <div class="proc-supplier-filters"><input id="procSupplierQuery" aria-label="Search supplier results" placeholder="Material, company or contact…" value="${esc(procurement.supplierQuery)}">
 <select id="procSupplierStatus" aria-label="Supplier result status">${[['all','All materials'],['attention','Needs attention'],['complete','With suppliers'],['pending','Not searched'],['failed','Failed'],['unavailable','No matches']].map(([v,t])=>`<option value="${v}" ${procurement.supplierStatus===v?'selected':''}>${t}</option>`).join('')}</select>
 <select id="procSupplierCountry" aria-label="Country"><option value="">All countries</option>${countries.map(c=>`<option ${procurement.supplierCountry===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
 <select id="procSupplierState" aria-label="State"><option value="">All states</option>${states.map(c=>`<option ${procurement.supplierState===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
 <select id="procSupplierSort" aria-label="Sort suppliers">${[['material','Material name'],['matches','Most matches'],['price','Currency, then lowest price']].map(([v,t])=>`<option value="${v}" ${procurement.supplierSort===v?'selected':''}>${t}</option>`).join('')}</select></div>
 <p class="proc-muted">Specification compatibility ranks first within each material. Unknown contacts and locations remain blank. Published prices are not firm quotations; checkout takes place on the supplier website.</p>
 <div id="procSupplierTable">${procSupplierTable()}</div>${procVendorCoverage()}`;
}

function procLeadFilter(lead){
 return (!procurement.supplierCountry||lead.country===procurement.supplierCountry)&&(!procurement.supplierState||lead.state===procurement.supplierState);
}
function procSupplierRows(){
 let rows=procurement.data.items.map(item=>{
  const saved=procurement.data.supplier_results[item.id],result=saved?.current?saved:null;
  const matches=(result?.results||[]).map((lead,index)=>({lead,index})).filter(x=>procLeadFilter(x.lead));
  return {item,result,saved,matches,status:result?.status||'pending'};
 }).filter(row=>{
  const query=procurement.supplierQuery.toLowerCase(),text=[row.item.name,row.item.specification,...row.matches.flatMap(x=>[x.lead.company,x.lead.email,x.lead.phone])].join(' ').toLowerCase();
  return text.includes(query)&&(!(procurement.supplierCountry||procurement.supplierState)||row.matches.length)&&
   (procurement.supplierStatus==='all'||procurement.supplierStatus===row.status||procurement.supplierStatus==='attention'&&(row.item.conflicts.length||['failed','unavailable','skipped','pending'].includes(row.status)));
 });
 rows.sort((a,b)=>{
  if(procurement.supplierSort==='matches')return b.matches.length-a.matches.length||a.item.name.localeCompare(b.item.name);
  if(procurement.supplierSort==='price'){const x=a.matches.find(x=>x.lead.price_comparable)?.lead,y=b.matches.find(x=>x.lead.price_comparable)?.lead;if(!x||!y)return Number(!x)-Number(!y);return x.currency.localeCompare(y.currency)||x.unit_price-y.unit_price}
  return a.item.name.localeCompare(b.item.name);
 });
 return rows;
}
function procSupplierTable(){
 const rows=procSupplierRows();
 procurement.supplierPage=Math.max(0,Math.min(procurement.supplierPage,Math.ceil(rows.length/procurement.pageSize)-1));
 const shown=rows.slice(procurement.supplierPage*procurement.pageSize,(procurement.supplierPage+1)*procurement.pageSize);
 return `<div class="proc-table-wrap"><table class="proc-table proc-supplier-table"><thead><tr><th>BOM material</th><th>Best candidate</th><th>Location</th><th>Published price</th><th>Status / matches</th></tr></thead><tbody>${shown.map(({item,result,saved,matches,status})=>{
  const lead=matches[0]?.lead,open=procurement.expanded.has(item.id);
  return `<tr><td><strong>${esc(item.name)}</strong><small>${item.quantity??'Unknown quantity'} ${esc(item.unit)} · ${esc(item.category)}</small></td><td>${esc(lead?.company||'—')}<small>${lead?esc(lead.match_level+' specification match'):esc(result?.message||(saved?'Previous result is outdated':'Awaiting search'))}</small></td><td>${lead?esc([lead.city,lead.state,lead.country].filter(Boolean).join(', ')||'Not found'):'—'}</td><td>${lead?.price_comparable?procAmount(lead.unit_price,esc(lead.currency))+' / '+esc(lead.unit):'Request quotation'}</td><td>${procBadge(procLabel(status),['failed','skipped','unavailable'].includes(status)?'warn':'')}${matches.length?`<button data-auto="toggle-suppliers" data-id="${item.id}" aria-expanded="${open}">${open?'Hide':'View'} ${matches.length} matches</button>`:''}</td></tr>${open?`<tr><td colspan="5" class="proc-expanded"><p class="proc-muted">AI filter basis: ${esc(result?.filter_basis||item.search_plan?.basis||'Unrestricted search.')}<br>Checked ${esc(result?.at||'')} · ${esc(result?.model||'')}</p>${matches.map(({lead,index})=>procSupplierCard(item,lead,index)).join('')}</td></tr>`:''}`;
 }).join('')||'<tr><td colspan="5">No materials match these filters. Generate a BOM first, or broaden the display filters.</td></tr>'}</tbody></table></div>${procPagination('suppliers',procurement.supplierPage,rows.length)}`;
}
function procSupplierCard(item,lead,index){
 const email=lead.email||'',phone=lead.phone||'';
 return `<article class="proc-lead"><div><h3>${esc(lead.company)}</h3><p>${esc(lead.product)}</p>${procBadge(lead.match_level+' match')}<p class="proc-muted">${esc(lead.match_reason)}<br>${esc(lead.specification_gaps||'Confirm specification and availability with the supplier.')}</p></div>
 <div><strong>Business contacts</strong><p>${email?`<a href="mailto:${esc(email)}">${esc(email)}</a>`:'Email: Not found'}<br>${phone?`<a href="tel:${esc(phone.replace(/[^+0-9]/g,''))}">${esc(phone)}</a>`:'Telephone: Not found'}</p><p class="proc-muted">City: ${esc(lead.city||'Not found')}<br>State: ${esc(lead.state||'Not found')}<br>Country: ${esc(lead.country||'Not found')}</p>${lead.contact_source_url?`<a href="${esc(lead.contact_source_url)}" target="_blank" rel="noopener noreferrer">Contact source ↗</a>`:''}</div>
 <div><strong>${lead.price_comparable?procAmount(lead.unit_price,esc(lead.currency))+' / '+esc(lead.unit):'Request quotation'}</strong><p class="proc-muted">${esc(lead.price_evidence||'No comparable price was found.')}</p><a href="${esc(lead.source_url)}" target="_blank" rel="noopener noreferrer">Visit supplier / buy ↗</a>${item.procurement_ready?`<div class="proc-actions"><button data-auto="lead-quote" data-id="${item.id}" data-index="${index}">Record verified quote</button></div>`:'<p class="proc-muted">Material has unresolved requirements; purchasing is unavailable.</p>'}</div></article>`;
}
function bindSupplierFilters(){
 for(const [id,key]of [['procSupplierQuery','supplierQuery'],['procSupplierStatus','supplierStatus'],['procSupplierCountry','supplierCountry'],['procSupplierState','supplierState'],['procSupplierSort','supplierSort']]){
  const element=document.getElementById(id);if(!element)continue;
  element[id==='procSupplierQuery'?'oninput':'onchange']=e=>{procurement[key]=e.target.value;procurement.supplierPage=0;if(key==='supplierCountry'){procurement.supplierState='';drawProcurement()}else procRenderSupplierTable()};
 }
}
function procRenderSupplierTable(){const table=$('#procSupplierTable');if(table)table.innerHTML=procSupplierTable()}
function procVendorCoverage(){
 const companies=new Map();
 for(const [id,r]of Object.entries(procurement.data.supplier_results||{})){if(!r.current)continue;for(const lead of r.results||[]){const key=lead.company+'|'+lead.country;const record=companies.get(key)||{company:lead.company,country:lead.country,materials:new Set()};record.materials.add(id);companies.set(key,record)}}
 const top=[...companies.values()].filter(c=>c.materials.size>1).sort((a,b)=>b.materials.size-a.materials.size).slice(0,10);
 return top.length?`<details class="proc-card"><summary>Companies appearing across multiple materials</summary><p class="proc-muted">Candidate coverage only; this does not confirm one supplier can fulfill every specification.</p>${top.map(c=>`<p><strong>${esc(c.company)}</strong> · ${esc(c.country||'Country unknown')} · ${c.materials.size} materials</p>`).join('')}</details>`:'';
}
