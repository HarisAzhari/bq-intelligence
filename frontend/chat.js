// Conversations are isolated by project and page and saved in browser storage.
const CHAT_STORAGE='atlas-sheet-chats-v1';
const sheetChats=new Map();
try{for(const [key,value] of JSON.parse(localStorage.getItem(CHAT_STORAGE)||'[]')){
 if(value && Array.isArray(value.turns))sheetChats.set(key,{...value,busy:false,error:''});
}}catch{}
function saveChats(){try{localStorage.setItem(CHAT_STORAGE,JSON.stringify([...sheetChats]));}catch{toast('Browser storage is full or unavailable. This chat will last until reload.')}renderChatHistory()}
function renderChatHistory(){
 const nav=document.querySelector('[data-nav="chat"]');if(!nav)return;
 let list=$('#chatHistory');if(!list){list=document.createElement('div');list.id='chatHistory';nav.after(list)}
 const entries=project?[...sheetChats].filter(([key,v])=>key.startsWith(project.id+':')&&v.turns.length).sort((a,b)=>(b[1].updated||0)-(a[1].updated||0)):[];
 list.innerHTML=entries.map(([key,v])=>{const page=Number(key.split(':').pop()),sheet=project.pages[page-1];return sheet?`<button data-chat-page="${page}" title="${esc(sheet.title)}"><strong>Page ${page} · ${esc(sheet.title)}</strong><small>${esc(v.turns.find(t=>t.role==='user')?.content||'Conversation')}</small></button>`:''}).join('');
 list.querySelectorAll('[data-chat-page]').forEach(b=>b.onclick=()=>{chatVisible=true;openPage(Number(b.dataset.chatPage))});
}
function usageLabel(u={}){
 const number=k=>Number.isFinite(u[k])?Number(u[k]).toLocaleString():'Unavailable';
 return `Input: ${number('prompt_tokens')} · Output: ${number('completion_tokens')} · Total: ${number('total_tokens')} tokens · Cost: ${Number.isFinite(u.cost)?'$'+u.cost.toFixed(5):'Unavailable'}`;
}
function totalUsage(turns){
 const replies=turns.filter(t=>t.role==='assistant'),sum={};
 for(const k of ['prompt_tokens','completion_tokens','total_tokens','cost'])if(replies.length&&replies.every(t=>Number.isFinite(t.usage?.[k])))sum[k]=replies.reduce((n,t)=>n+t.usage[k],0);
 return sum;
}
function clearSourceHighlight(){document.querySelectorAll('.source-highlight').forEach(x=>x.remove())}
let showHighlights=true, regionObserver=null;
const replyColors=["#e9a126","#3a86ff","#a855f7","#e34d72","#199c76"];
function replyColor(state,i){const c=state.colors?.[i];return /^#[0-9a-f]{6}$/i.test(c||"")?c:replyColors[Math.floor(i/2)%replyColors.length]}
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
 if(!Array.isArray(source.box)||source.box.length!==4||!source.box.every(Number.isFinite))continue;
 const key=JSON.stringify([source.page,...source.box]);if(seen.has(key))continue;
 seen.add(key);regions.push({source,owner});
 }
 });return regions;
}
function drawHighlights(){
 clearSourceHighlight();if(!project||!showHighlights)return;
 const img=$('#drawingImage'),scroll=$('#drawingScroll');
 const state=chatState(chatKey());
 for(const {source,owner:i} of visibleRegions(state)){
 const [x0,y0,x1,y1]=source.box;
 const el=document.createElement('div');el.className='source-highlight persistent-region';
 el.style.cssText=`left:${img.offsetLeft+x0*img.clientWidth}px;top:${img.offsetTop+y0*img.clientHeight}px;width:${(x1-x0)*img.clientWidth}px;height:${(y1-y0)*img.clientHeight}px;border-color:${replyColor(state,i)};background:${replyColor(state,i)}33`;
 el.innerHTML=`<span>${esc(source.label)} · ${source.kind==='user'?'User confirmed':source.kind==='ai'?'AI approximate':'Text match'}</span>`;
 scroll.append(el);
 }
}

async function persistConversation(key){
 const state=chatState(key),[pid,page]=key.split(':');state.saving=true;state.saveStatus='Saving…';saveChats();
 try{const saved=await api(`/api/projects/${pid}/pages/${page}/conversation`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({turns:state.turns,updated:Date.now(),revision:state.revision||0,selected:state.selected??null,colors:state.colors||{}})});state.revision=saved.revision;state.saveStatus='Saved to project';saveChats()}
 catch(e){state.saveStatus='Save failed: '+e.message;toast(state.saveStatus)}
 finally{state.saving=false;if(project&&chatKey()===key)renderSheetChat()}
}
async function loadSavedChats(pid){
 const saved=await api(`/api/projects/${pid}/chats`);
 for(const [page,state] of Object.entries(saved))sheetChats.set(pid+':'+page,{...state,draft:'',busy:false,error:'',saveStatus:'Saved to project'});
 for(const [key,state] of sheetChats)if(key.startsWith(pid+':')&&!saved[key.split(':')[1]]&&state.turns.length)await persistConversation(key);
 saveChats();
}
let chatVisible=false;
function chatKey(){return project.id+':'+currentPage}
function chatState(key){if(!sheetChats.has(key))sheetChats.set(key,{turns:[],draft:'',busy:false,error:''});return sheetChats.get(key)}
function mountSheetChat(){
 clearSourceHighlight();
 const details=$('#drawingDetails');
 const context=document.createElement('div');context.id='sheetContext';
 while(details.firstChild)context.append(details.firstChild);
 details.append(context);
 const tabs=document.createElement('div');tabs.className='sheet-panel-tabs';
 tabs.innerHTML='<button id="sheetInfoTab">Sheet details</button><button id="sheetChatTab">✧ Ask about this sheet</button>';
 details.prepend(tabs);
 const panel=document.createElement('section');panel.id='sheetChat';details.append(panel);
 $('#sheetInfoTab').onclick=()=>{chatVisible=false;renderSheetChat()};
 $('#sheetChatTab').onclick=()=>{chatVisible=true;renderSheetChat();$('#sheetQuestion').focus()};
 if(route==='chat')chatVisible=true;
 renderSheetChat();
 const img=$('#drawingImage');img.onload=drawHighlights;
 if(!$('#highlightToggle')){const toggle=document.createElement('button');toggle.id='highlightToggle';toggle.textContent='Show / hide highlights';toggle.onclick=()=>{showHighlights=!showHighlights;drawHighlights()};$('.viewer-tools').append(toggle)}

 if(regionObserver)regionObserver.disconnect();regionObserver=new ResizeObserver(()=>drawHighlights());regionObserver.observe(img);
 drawHighlights();
}
function renderSheetChat(){
 if(!$('#sheetChat'))return;
 const key=chatKey(),state=chatState(key),s=project.pages[currentPage-1];
 $('#sheetContext').hidden=chatVisible;$('#sheetChat').hidden=!chatVisible;
 $('#viewer').classList.toggle('chat-open',chatVisible);
 $('#sheetChatTab').classList.toggle('active',chatVisible);$('#sheetInfoTab').classList.toggle('active',!chatVisible);
 $('#sheetChat').innerHTML=`<div class="chat-scope"><span class="eyebrow">THIS SHEET ONLY · PAGE ${currentPage}</span><h3>${esc(s.title)}</h3><p>${esc(s.number||'Source drawing')} · ${esc(s.stage)}</p></div>
 <div class="chat-messages" role="log" aria-label="Sheet conversation" aria-live="polite">${state.turns.length?state.turns.map((t,i)=>`<div class="chat-message ${t.role}"><strong>${t.role==='user'?'You':'Drawing assistant'}</strong><div>${esc(t.content)}</div>${t.role==='assistant'?`<div class="chat-usage">${t.cached?'Reused saved answer · 0 new tokens<br>':''}${Number.isInteger(t.highlight_ref)?'Uses highlights from reply '+(Math.floor(highlightOwner(state,i)/2)+1)+'<br>':''}${esc(usageLabel(t.usage))}</div>${(t.sources||[]).map(source=>`<span class="source-label">${esc(source.label)} · Page ${currentPage}</span>`).join('')}`:''}</div>`).join(''):'<p class="chat-intro">Ask about the layout, visible dimensions or notes. If this sheet does not show the answer, the assistant will say so.</p>'}${state.busy?'<p role="status">Reading this sheet… You can browse other drawings while waiting.</p>':''}</div>
 ${!state.turns.length?'<div class="chat-prompts">'+['Explain this layout.','What dimensions are shown?','What work is marked?'].map(q=>`<button type="button" data-prompt="${esc(q)}">${esc(q)}</button>`).join('')+'</div>':''}
 <div class="chat-usage">Conversation total: ${esc(usageLabel(totalUsage(state.turns)))}</div>
 <fieldset class="reply-filters" ${state.busy||state.saving?'disabled':''}><legend>Highlight filters and colors</legend>
 ${state.turns.map((t,i)=>t.role==='assistant'&&t.sources?.length?`<label><input type="checkbox" data-filter="${i}" ${state.selected==null||state.selected.includes(i)?'checked':''}><input type="color" data-color="${i}" value="${replyColor(state,i)}" aria-label="Color for reply ${Math.floor(i/2)+1}"><span>Reply ${Math.floor(i/2)+1} · ${esc(t.content.slice(0,55))}</span></label>`:'').join('')}
 <button type="button" id="clearReplyFilters">Clear filters · Show all</button></fieldset>
 <p class="chat-footnote" id="saveState" role="status">${esc(state.saveStatus||'No saved changes yet')}</p>
 <p class="chat-scope">Next question: Page ${currentPage} · ${state.selected==null?'Whole sheet · All highlights':state.selected.length?'Focus on replies '+state.selected.map(i=>Math.floor(i/2)+1).join(', '):'No highlight groups selected'}</p>
 ${state.previousChoice?`<section class="previous-answer" role="status"><strong>Previous answer found</strong><p>${esc(state.previousChoice.reason)}</p><blockquote>${esc(state.previousChoice.previous_answer)}</blockquote><button type="button" id="usePrevious" ${state.busy||state.saving?'disabled':''}>Use previous answer · No new tokens</button><button type="button" id="freshPrevious" ${state.busy||state.saving?'disabled':''}>Generate fresh · Paid request</button></section>`:''}
 <form id="sheetChatForm"><label for="sheetQuestion">Your question</label><textarea id="sheetQuestion" maxlength="4000" required placeholder="Ask about this sheet…" ${state.busy||state.saving?'disabled':''}>${esc(state.draft)}</textarea><p class="chat-error" role="alert">${esc(state.error)}</p><label class="fresh-answer"><input type="checkbox" id="freshAnswer"> Generate a fresh answer (bypass saved answers)</label><button class="primary" type="submit" ${state.busy||state.saving?'disabled':''}>${state.busy?'Reading…':'Send question'}</button><p class="chat-footnote">Matching saved answers use no new AI tokens. Fresh answers use paid requests. Only this page’s text and images are sent with this conversation. Chats and highlights are saved with this project. AI regions are approximate. Filters guide the next answer; changing colors or filters makes no AI request.</p></form>`;
 $('#sheetQuestion').oninput=e=>{state.draft=e.target.value;if(state.previousChoice){state.previousChoice=null;$('#sheetChat .previous-answer')?.remove()}};
 $('#sheetChat').querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{state.draft=b.dataset.prompt;$('#sheetQuestion').value=state.draft;$('#sheetQuestion').focus()});
 $('#sheetChat').querySelectorAll('[data-filter]').forEach(b=>b.onchange=()=>{state.selected=[...$('#sheetChat').querySelectorAll('[data-filter]:checked')].map(x=>Number(x.dataset.filter));persistConversation(key);renderSheetChat()});
 $('#sheetChat').querySelectorAll('[data-color]').forEach(b=>b.onchange=()=>{state.colors={...state.colors,[b.dataset.color]:b.value};persistConversation(key);renderSheetChat()});
 $('#clearReplyFilters').onclick=()=>{state.selected=null;persistConversation(key);renderSheetChat()};
 drawHighlights();
 if($('#usePrevious'))$('#usePrevious').onclick=()=>sendSheetQuestion(key,false,state.previousChoice.previous_turn);
 if($('#freshPrevious'))$('#freshPrevious').onclick=()=>sendSheetQuestion(key,true);
 $('#sheetChatForm').onsubmit=e=>{e.preventDefault();sendSheetQuestion(key,$('#freshAnswer').checked)};
 const log=$('#sheetChat .chat-messages');log.scrollTop=log.scrollHeight;
}
async function sendSheetQuestion(key,fresh=false,reuseTurn=null){
 const state=chatState(key),question=state.draft.trim();if(state.busy||state.saving||!question)return;
 const pid=project.id,page=currentPage;
 state.busy=true;state.error='';renderSheetChat();
 try{
  const result=await api(`/api/projects/${pid}/pages/${page}/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,fresh,reuse_turn:reuseTurn,history:state.turns.slice(-20).map(t=>({role:t.role,content:t.content}))})});
  if(result.needs_choice){state.previousChoice=result;return}
  state.previousChoice=null;
  if(result.conversation){state.turns=result.conversation.turns;state.revision=result.conversation.revision}else state.turns.push({role:'user',content:question},{role:'assistant',content:result.answer,usage:result.usage||{},sources:result.sources||[]});state.draft='';state.updated=Date.now();state.saveStatus='Saved to project';saveChats();
 }catch(e){state.error=e.message}
 finally{state.busy=false;if(project?.id===pid&&currentPage===page)renderSheetChat()}
}

renderChatHistory();
