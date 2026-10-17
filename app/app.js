const labels={inicio:"Início",ia:"Assistente IA",figurinhas:"Estúdio de figurinhas",midia:"Central de mídia",fit:"Área Fit",dieta:"Nutrição",financas:"Finanças",lembretes:"Lembretes",historico:"Histórico",organizacao:"Tarefas e notas",config:"Configurações"};
let supabaseClient=null, session=null, busy=false, vapidPublicKey='';
const $=selector=>document.querySelector(selector);
function createRobotIcon(){
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");
  svg.setAttribute("stroke-width","1.7");svg.setAttribute("stroke-linecap","round");svg.setAttribute("stroke-linejoin","round");
  svg.setAttribute("aria-hidden","true");svg.classList.add("nuvem-robot-svg");
  const shapes=[["path",{d:"M12 3v2"}],["circle",{cx:"12",cy:"2.7",r:"1",fill:"currentColor",stroke:"none"}],["rect",{x:"4.2",y:"6",width:"15.6",height:"13",rx:"4"}],["path",{d:"M2.5 10v5M21.5 10v5M8 22v-3M16 22v-3"}],["circle",{cx:"9",cy:"11.5",r:"1",fill:"currentColor",stroke:"none"}],["circle",{cx:"15",cy:"11.5",r:"1",fill:"currentColor",stroke:"none"}],["path",{d:"M9 15h6"}]];
  for(const [tag,attrs] of shapes){const shape=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))shape.setAttribute(key,value);svg.appendChild(shape);}
  return svg;
}
function createFolderIcon(){
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("fill","none");svg.setAttribute("stroke","currentColor");svg.setAttribute("stroke-width","1.8");svg.setAttribute("stroke-linecap","round");svg.setAttribute("stroke-linejoin","round");svg.setAttribute("aria-hidden","true");svg.classList.add("nuvem-folder-svg");
  for(const [tag,attrs] of [["path",{d:"M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"}],["path",{d:"M3.5 10h17"}]]){const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);svg.appendChild(el);}
  return svg;
}

/* Aparência: inicialização antecipada + eventos delegados para sobreviver a atualizações da interface */
const THEME_STORAGE_KEY="nuvem-theme";
function aplicarTema(tema,persistir=true){
  const selecionado=tema==="dark"?"dark":"light";
  document.documentElement.dataset.theme=selecionado;
  document.documentElement.style.colorScheme=selecionado;
  if(persistir){try{localStorage.setItem(THEME_STORAGE_KEY,selecionado)}catch{}}
  const isLight=selecionado==="light";
  const toggle=$("#theme-toggle"),icon=$("#theme-toggle-icon"),meta=$("#theme-color-meta");
  if(toggle){toggle.setAttribute("aria-label",isLight?"Ativar tema escuro":"Ativar tema claro");toggle.title=isLight?"Ativar tema escuro":"Ativar tema claro";toggle.setAttribute("aria-pressed",String(!isLight));}
  if(icon){icon.textContent=isLight?"☼":"☾";icon.style.display="inline-block";icon.style.fontSize="23px";}
  if(meta)meta.setAttribute("content",isLight?"#e8e6de":"#171916");
  document.querySelectorAll("[data-theme-choice]").forEach(button=>button.setAttribute("aria-checked",String(button.dataset.themeChoice===selecionado)));
}
let temaInicial="light";
try{temaInicial=localStorage.getItem(THEME_STORAGE_KEY)||document.documentElement.dataset.theme||"light"}catch{}
aplicarTema(temaInicial,false);
document.addEventListener("click",event=>{
  const toggle=event.target.closest?.("#theme-toggle");
  if(toggle){event.preventDefault();aplicarTema(document.documentElement.dataset.theme==="light"?"dark":"light");return;}
  const choice=event.target.closest?.("[data-theme-choice]");
  if(choice){event.preventDefault();aplicarTema(choice.dataset.themeChoice);}
});
function abrirVista(nome){if(!labels[nome])return;const moreMenu=$("#mobile-more-menu"),moreToggle=$("#mobile-more-toggle");if(moreMenu)moreMenu.hidden=true;if(moreToggle)moreToggle.setAttribute("aria-expanded","false");document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active",el.id==="view-"+nome));document.querySelectorAll("[data-view]").forEach(el=>el.classList.toggle("active",el.dataset.view===nome));const crumb=$("#crumb");if(crumb)crumb.textContent=labels[nome];window.scrollTo({top:0,behavior:"smooth"});window.dispatchEvent(new CustomEvent("nuvem:viewchange",{detail:{view:nome}}));}
document.querySelectorAll("[data-view]").forEach(el=>el.addEventListener("click",()=>abrirVista(el.dataset.view)));
$("#mobile-more-toggle")?.addEventListener("click",event=>{event.preventDefault();const menu=$("#mobile-more-menu"),button=$("#mobile-more-toggle");if(!menu||!button)return;menu.hidden=!menu.hidden;button.setAttribute("aria-expanded",String(!menu.hidden));});
document.addEventListener("click",event=>{const menu=$("#mobile-more-menu"),toggle=$("#mobile-more-toggle");if(!menu||!toggle||menu.hidden)return;if(!menu.contains(event.target)&&!toggle.contains(event.target)){menu.hidden=true;toggle.setAttribute("aria-expanded","false");}});
function setLoginStatus(message,isError=false){const el=$("#login-status");if(el){el.textContent=message;el.classList.toggle("error-text",isError);}}
function setApiStatus(selector,message,isError=false){const el=$(selector);if(el){el.textContent=message;el.classList.toggle("error-text",isError);el.classList.toggle("is-thinking",!isError&&/pensando|processando|gerando|preparando|carregando/i.test(String(message||"")));}}
async function api(path,options={}){if(!session?.access_token)throw new Error("Entre na sua conta novamente.");const response=await fetch(path,{...options,headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token,...(options.headers||{})}});let body={};try{body=await response.json()}catch{}if(!response.ok){const error=new Error(body.error||"Não foi possível concluir a operação.");error.status=response.status;throw error;}return body;}
function formatBRL(value){return Number(value||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
let chatList=[],activeChatId=null,chatMigrationMissing=false;
function appendInlineFormatting(parent,text){
  const pattern=/(\*\*[^*]+\*\*|\*[^*]+\*)/g;let cursor=0,match;
  while((match=pattern.exec(text))){if(match.index>cursor)parent.appendChild(document.createTextNode(text.slice(cursor,match.index)));const token=match[0];const strong=token.startsWith("**");const element=document.createElement(strong?"strong":"em");element.textContent=token.slice(strong?2:1,strong?-2:-1);parent.appendChild(element);cursor=pattern.lastIndex;}
  if(cursor<text.length)parent.appendChild(document.createTextNode(text.slice(cursor)));
}
function renderAssistantContent(container,content){
  const fence=String.fromCharCode(96).repeat(3),chunks=String(content??"").split(fence);
  chunks.forEach((chunk,index)=>{
    if(index%2===1){const codeText=chunk.replace(/^[a-zA-Z0-9_+#.-]{1,20}\r?\n/,"");const pre=node("pre","chat-code-block"),code=node("code","",codeText);pre.appendChild(code);container.appendChild(pre);return;}
    let list=null;
    for(const line of chunk.split(/\r?\n/)){
      if(!line.trim()){list=null;continue;}
      const heading=line.match(/^(#{1,3})\s+(.+)$/);
      const bullet=line.match(/^\s*[-*]\s+(.+)$/);
      if(bullet){if(!list){list=document.createElement("ul");list.className="chat-markdown-list";container.appendChild(list);}const li=document.createElement("li");appendInlineFormatting(li,bullet[1]);list.appendChild(li);continue;}
      list=null;
      if(heading){const h=document.createElement(heading[1].length===1?"h3":heading[1].length===2?"h4":"h5");appendInlineFormatting(h,heading[2]);container.appendChild(h);continue;}
      if(line.startsWith("> ")){const quote=document.createElement("blockquote");appendInlineFormatting(quote,line.slice(2));container.appendChild(quote);continue;}
      const paragraph=document.createElement("p");appendInlineFormatting(paragraph,line);container.appendChild(paragraph);
    }
  });
}
function scrollChatToBottom(force=false){
  const area=$("#chat-messages");if(!area)return;
  const nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<150;
  if(force||nearBottom)requestAnimationFrame(()=>{area.scrollTop=area.scrollHeight;});
}
function addChatMessage(role,content){
  const area=$("#chat-messages");if(!area)return null;
  const isUser=role==="user",bubble=node("article","chat-message "+(isUser?"user-message":"assistant-message"));
  bubble.dataset.role=role;const body=node("div","message-content");
  if(isUser)body.textContent=String(content??"");
  else{
    const head=node("div","assistant-message-head"),robot=node("span","assistant-robot"),name=node("span","assistant-name","Nuvem");
    robot.setAttribute("aria-hidden","true");robot.appendChild(createRobotIcon());head.append(robot,name);bubble.appendChild(head);
    renderAssistantContent(body,content);
  }
  bubble.appendChild(body);
  if(!isUser){
    const actions=node("div","message-actions"),copy=node("button","message-copy","Copiar");
    copy.type="button";copy.setAttribute("aria-label","Copiar resposta");copy.addEventListener("click",async()=>{
      try{await navigator.clipboard.writeText(String(content??""));copy.textContent="Copiado";setTimeout(()=>{copy.textContent="Copiar";},1400);}
      catch{setApiStatus("#chat-status","Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.",true);}
    });
    actions.appendChild(copy);bubble.appendChild(actions);
  }
  area.appendChild(bubble);scrollChatToBottom();return bubble;
}
function addTypingIndicator(){
  removeTypingIndicator();const area=$("#chat-messages");if(!area)return null;
  const bubble=node("article","chat-message assistant-message typing-message");bubble.setAttribute("aria-label","A Nuvem está pensando e preparando uma resposta");
  const body=node("div","message-content"),head=node("div","typing-head"),robot=node("span","typing-robot"),label=node("span","typing-label","A Nuvem está pensando"),indicator=node("div","typing-indicator");
  robot.setAttribute("aria-hidden","true");robot.appendChild(createRobotIcon());indicator.setAttribute("aria-hidden","true");
  for(let i=0;i<3;i++)indicator.appendChild(node("span","typing-dot"));
  head.append(robot,label,indicator);body.appendChild(head);bubble.appendChild(body);area.appendChild(bubble);scrollChatToBottom(true);return bubble;
}
function removeTypingIndicator(){document.querySelectorAll("#chat-messages .typing-message").forEach(el=>el.remove());}
function updatePromptSuggestions(show){const suggestions=$("#ai-prompt-suggestions");if(suggestions)suggestions.hidden=!show;}
function renderChatList(){const area=$("#chat-list");if(!area)return;area.replaceChildren();if(!chatList.length){area.appendChild(node("p","chat-list-empty","Suas conversas aparecerão aqui."));return;}for(const chat of chatList){const row=node("div","chat-list-row"+(chat.id===activeChatId?" active":"")),pick=node("button","chat-list-pick"),icon=node("span","chat-list-icon"),title=node("span","chat-list-title",chat.title||"Nova conversa");pick.type="button";pick.append(icon,title);pick.addEventListener("click",async()=>{activeChatId=chat.id;renderChatList();await loadChat();});row.appendChild(pick);area.appendChild(row);}}
async function loadChats(){
  const area=$("#chat-messages");
  try{
    const data=await api("/api/app/chats");
    chatList=data.chats||[];chatMigrationMissing=Boolean(data.legacy);
    if(!chatList.length){
      const created=await api("/api/app/chats",{method:"POST",body:JSON.stringify({title:"Nova conversa"})});
      chatList=[created.chat];
    }
    activeChatId=chatList[0]?.id||null;renderChatList();
    const newButton=$("#chat-new"),deleteButton=$("#chat-delete");
    if(newButton)newButton.disabled=!session||chatMigrationMissing;
    if(deleteButton)deleteButton.disabled=!session||chatMigrationMissing;
    if(activeChatId)await loadChat();
    else{area?.replaceChildren();addChatMessage("assistant","Olá! Sou a Nuvem. Como posso ajudar?");}
    if(chatMigrationMissing)setApiStatus("#chat-status","Assistente pronto. O histórico está no modo simples; você pode conversar normalmente.",false);
    else if(activeChatId)setApiStatus("#chat-status","Conversa pronta. Pode escrever sua mensagem.",false);
    updatePromptSuggestions(Boolean(!area?.querySelector(".user-message")));
  }catch(e){
    chatMigrationMissing=false;chatList=[];activeChatId=null;renderChatList();
    if(area){area.replaceChildren();addChatMessage("assistant","Não consegui abrir seu histórico. "+e.message);}
    updatePromptSuggestions(true);
    setApiStatus("#chat-status",e.message||"Não foi possível carregar suas conversas.",true);
    const input=$("#chat-input"),send=$("#chat-send");
    if(session&&input)input.disabled=false;
    if(session&&send)send.disabled=false;
  }
}
async function loadChat(){const area=$("#chat-messages");if(!area)return;area.replaceChildren();if(!activeChatId){addChatMessage("assistant","Crie uma conversa para começar.");return;}try{const data=await api("/api/app/chat?conversation_id="+encodeURIComponent(activeChatId)+"&limit=40");if(!data.messages.length)addChatMessage("assistant","Olá! Sou a Nuvem. Como posso ajudar?");for(const m of data.messages)addChatMessage(m.role,m.content);const current=chatList.find(c=>c.id===activeChatId);if(current&&$("#chat-current-title"))$("#chat-current-title").textContent=current.title||"Nova conversa";}catch(e){addChatMessage("assistant",e.message);}}
async function createChat(){
  if(!session||busy)return;
  if(chatMigrationMissing){setApiStatus("#chat-status","A conversa principal já está disponível. Para criar conversas separadas, aplique a migração de múltiplas conversas no Supabase.",true);return;}
  const button=$("#chat-new");if(button)button.disabled=true;
  try{
    const data=await api("/api/app/chats",{method:"POST",body:JSON.stringify({title:"Nova conversa"})});
    chatList.unshift(data.chat);activeChatId=data.chat.id;renderChatList();await loadChat();
    setApiStatus("#chat-status","Nova conversa pronta.");$("#chat-input")?.focus();
  }catch(e){setApiStatus("#chat-status",e.message,true);}
  finally{if(button)button.disabled=!session||chatMigrationMissing;}
}
async function deleteChat(){
  if(!session||!activeChatId||busy)return;
  if(chatMigrationMissing){setApiStatus("#chat-status","A conversa principal não pode ser excluída neste modo simples.",true);return;}
  if(!confirm("Excluir esta conversa e todas as mensagens dela? Essa ação não pode ser desfeita."))return;
  const button=$("#chat-delete");if(button)button.disabled=true;
  try{
    await api("/api/app/chats/"+encodeURIComponent(activeChatId),{method:"DELETE"});
    chatList=chatList.filter(c=>c.id!==activeChatId);
    if(!chatList.length){const data=await api("/api/app/chats",{method:"POST",body:JSON.stringify({title:"Nova conversa"})});chatList=[data.chat];}
    activeChatId=chatList[0].id;renderChatList();await loadChat();setApiStatus("#chat-status","Conversa excluída.");
  }catch(e){setApiStatus("#chat-status",e.message,true);}
  finally{if(button)button.disabled=!session||chatMigrationMissing;}
}
$("#chat-new")?.addEventListener("click",createChat);
$("#chat-delete")?.addEventListener("click",deleteChat);
$("#chat-audio-button")?.addEventListener("click",()=>$("#chat-audio-file")?.click());
$("#chat-audio-file")?.addEventListener("change",async event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>12*1024*1024){setApiStatus("#chat-status","O áudio precisa ter até 12 MB.",true);event.target.value="";return;}if(!session?.access_token){setApiStatus("#chat-status","Entre na sua conta para enviar áudio.",true);return;}const button=$("#chat-audio-button");button.disabled=true;setApiStatus("#chat-status","Transcrevendo seu áudio para a Nuvem…");try{const mime=file.type||"audio/webm";const response=await fetch("/api/app/chat/transcribe",{method:"POST",headers:{Authorization:"Bearer "+session.access_token,"Content-Type":mime},body:file,cache:"no-store"});let data={};try{data=await response.json();}catch{}if(!response.ok)throw new Error(data.error||"Não consegui entender esse áudio.");const input=$("#chat-input");input.value=data.text;input.style.height="auto";input.style.height=Math.min(input.scrollHeight,180)+"px";input.focus();setApiStatus("#chat-status","Áudio transcrito. Revise o texto e toque em enviar.");}catch(e){setApiStatus("#chat-status",e.message,true);}finally{button.disabled=!session;event.target.value="";}});
let historyMessages=[];
function drawHistory(){const list=$("#history-list");if(!list)return;const term=($("#history-search")?.value||"").trim().toLowerCase();const filtered=historyMessages.filter(m=>!term||m.content.toLowerCase().includes(term));list.replaceChildren();if(!filtered.length){list.appendChild(node("p","muted",term?"Nenhum resultado para essa busca.":"Seu histórico ainda está vazio."));return;}for(const m of filtered.slice().reverse()){const item=node("article","history-item"),top=node("div","history-item-top"),role=node("strong","",m.role==="user"?"Você":"Nuvem"),date=node("small","",new Date(m.created_at).toLocaleString("pt-BR")),content=node("p","",m.content);top.append(role,date);item.append(top,content);list.appendChild(item);}}
async function loadHistory(){try{const data=await api("/api/app/chat?limit=100");historyMessages=data.messages||[];drawHistory();}catch(e){historyMessages=[];drawHistory();}}
$("#history-search")?.addEventListener("input",drawHistory);

const isoToday=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};
function addExerciseRow(v={}){const area=$("#fit-exercises");if(!area)return;const row=node("div","fit-exercise-row"),name=document.createElement("input"),sets=document.createElement("input"),reps=document.createElement("input"),del=node("button","exercise-remove","×");name.placeholder="Exercício";name.value=v.name||"";name.maxLength=90;name.required=true;name.setAttribute("aria-label","Nome do exercício");sets.type="number";sets.min="1";sets.max="20";sets.value=v.sets||3;sets.setAttribute("aria-label","Séries");reps.placeholder="Reps/tempo";reps.value=v.reps||"8–12";reps.maxLength=24;reps.setAttribute("aria-label","Repetições ou duração");del.type="button";del.setAttribute("aria-label","Remover exercício");del.addEventListener("click",()=>{row.remove();updateFitCount();});name.addEventListener("input",updateFitCount);row.append(name,sets,reps,del);area.appendChild(row);updateFitCount();}
function updateFitCount(){const n=$("#fit-exercises")?.children.length||0;$("#fit-routine-count").textContent=n+" exercício"+(n===1?"":"s");}
function collectExercises(){return [...($("#fit-exercises")?.querySelectorAll(".fit-exercise-row")||[])].map(r=>({name:r.children[0].value.trim(),sets:Number(r.children[1].value)||3,reps:r.children[2].value.trim()})).filter(x=>x.name);}
function addFoodRow(v={}){const area=$("#meal-foods");if(!area)return;const row=node("div","meal-food-row"),name=document.createElement("input"),amount=document.createElement("input"),del=node("button","exercise-remove","×");name.placeholder="Alimento";name.value=v.name||"";name.maxLength=100;name.required=true;name.setAttribute("aria-label","Alimento");amount.placeholder="Quantidade opcional";amount.value=v.amount||"";amount.maxLength=60;amount.setAttribute("aria-label","Quantidade aproximada");del.type="button";del.setAttribute("aria-label","Remover alimento");del.addEventListener("click",()=>row.remove());row.append(name,amount,del);area.appendChild(row);}
function collectFoods(){return [...($("#meal-foods")?.querySelectorAll(".meal-food-row")||[])].map(r=>({name:r.children[0].value.trim(),amount:r.children[1].value.trim()})).filter(x=>x.name);}
function drawWellnessHistory(type,selector,records){const area=$(selector);if(!area)return;area.replaceChildren();const list=records.filter(r=>r.record_type===type);if(!list.length){area.appendChild(node("p","muted",type==="workout"?"Você ainda não salvou treinos.":"Você ainda não salvou refeições."));return;}for(const r of list){const card=node("article","wellness-history-card"),head=node("div","wellness-record-head"),title=node("strong","",r.title),date=node("small","",new Date(r.entry_date+"T12:00:00").toLocaleDateString("pt-BR")),del=node("button","wellness-delete","Excluir");head.append(title,date,del);card.appendChild(head);card.appendChild(node("p","wellness-record-meta",r.payload.kind||"Registro"));const items=node("div","wellness-record-items");for(const e of (type==="workout"?(r.payload.exercises||[]):(r.payload.foods||[]))){items.appendChild(node("span","wellness-chip",type==="workout"?e.name+" · "+e.sets+" séries · "+e.reps:e.name+(e.amount?" · "+e.amount:"")));}if(items.children.length)card.appendChild(items);if(r.payload.notes)card.appendChild(node("p","wellness-record-notes",r.payload.notes));del.type="button";del.addEventListener("click",async()=>{if(!confirm("Excluir este registro?"))return;del.disabled=true;try{await api("/api/app/wellness/"+encodeURIComponent(r.id),{method:"DELETE"});await loadWellnessRecords();}catch(e){setApiStatus(type==="workout"?"#fit-status":"#meal-status",e.message,true);del.disabled=false;}});area.appendChild(card);}}
async function loadWellnessRecords(){if(!session)return;try{const d=await api("/api/app/wellness"),records=d.records||[];drawWellnessHistory("workout","#fit-history",records);drawWellnessHistory("meal","#meal-history",records);$("#fit-session-count").textContent=records.filter(r=>r.record_type==="workout").length+" sessões";}catch(e){setApiStatus("#fit-status",e.message,true);setApiStatus("#meal-status",e.message,true);}}
$("#fit-add-exercise")?.addEventListener("click",()=>addExerciseRow());
$("#fit-form")?.addEventListener("submit",async e=>{e.preventDefault();if(!session)return;const exercises=collectExercises();if(!exercises.length)return setApiStatus("#fit-status","Adicione pelo menos um exercício.",true);const button=$("#fit-save");button.disabled=true;setApiStatus("#fit-status","Salvando treino…");try{await api("/api/app/wellness",{method:"POST",body:JSON.stringify({record_type:"workout",title:$("#fit-title").value.trim(),entry_date:$("#fit-date").value||isoToday(),payload:{kind:$("#fit-kind").value,exercises,notes:$("#fit-notes").value.trim()}})});setApiStatus("#fit-status","✓ Treino salvo na sua conta.");$("#fit-title").value="";$("#fit-notes").value="";$("#fit-exercises").replaceChildren();addExerciseRow();await loadWellnessRecords();}catch(err){setApiStatus("#fit-status",err.message,true);}finally{button.disabled=false;}});
$("#meal-add-food")?.addEventListener("click",()=>addFoodRow());
$("#meal-form")?.addEventListener("submit",async e=>{e.preventDefault();if(!session)return;const foods=collectFoods();if(!foods.length)return setApiStatus("#meal-status","Adicione pelo menos um alimento.",true);const button=$("#meal-save");button.disabled=true;setApiStatus("#meal-status","Salvando refeição…");try{await api("/api/app/wellness",{method:"POST",body:JSON.stringify({record_type:"meal",title:$("#meal-title").value.trim(),entry_date:$("#meal-date").value||isoToday(),payload:{kind:$("#meal-kind").value,foods,notes:$("#meal-notes").value.trim()}})});setApiStatus("#meal-status","✓ Refeição salva na sua conta.");$("#meal-title").value="";$("#meal-notes").value="";$("#meal-foods").replaceChildren();addFoodRow();await loadWellnessRecords();}catch(err){setApiStatus("#meal-status",err.message,true);}finally{button.disabled=false;}});
$("#meal-photo")?.addEventListener("change",()=>{const file=$("#meal-photo").files?.[0],area=$("#meal-photo-preview");if(!area)return;area.replaceChildren();if(!file){area.append(node("span","","◒"),node("small","","A prévia da foto aparecerá aqui"));return;}if(!file.type.startsWith("image/"))return setApiStatus("#meal-photo-status","Escolha uma imagem.",true);const image=document.createElement("img");image.alt="Prévia da refeição";image.src=URL.createObjectURL(file);area.appendChild(image);});
$("#meal-photo-form")?.addEventListener("submit",async e=>{e.preventDefault();if(!session)return;const file=$("#meal-photo")?.files?.[0];if(!file)return setApiStatus("#meal-photo-status","Escolha uma foto primeiro.",true);if(!["image/jpeg","image/png","image/webp"].includes(file.type))return setApiStatus("#meal-photo-status","Use JPG, PNG ou WebP.",true);if(file.size>4*1024*1024)return setApiStatus("#meal-photo-status","A foto precisa ter até 4 MB.",true);const button=$("#meal-photo-submit"),result=$("#meal-photo-result");button.disabled=true;result.hidden=true;setApiStatus("#meal-photo-status","Analisando a foto com IA…");try{const response=await fetch("/api/app/nutrition/analyze-photo",{method:"POST",headers:{Authorization:"Bearer "+session.access_token,"Content-Type":file.type},body:file,cache:"no-store"});let body={};try{body=await response.json()}catch{}if(!response.ok)throw new Error(body.error||"Não foi possível analisar a foto.");result.replaceChildren(node("h3","","Análise da refeição"),node("p","meal-analysis-copy",body.analysis||"Sem resultado."),node("p","meal-analysis-disclaimer",body.disclaimer||"Estimativa visual aproximada."));const use=node("button","button button-secondary","Usar como observação da refeição");use.type="button";use.addEventListener("click",()=>{$("#meal-notes").value=($("#meal-notes").value?$("#meal-notes").value+"\n":"")+(body.analysis||"");$("#meal-title").value=$("#meal-title").value||"Refeição analisada por foto";$("#meal-status").scrollIntoView({behavior:"smooth",block:"center"});});result.appendChild(use);result.hidden=false;setApiStatus("#meal-photo-status","Análise concluída. Confira as incertezas antes de usar os valores.");}catch(err){setApiStatus("#meal-photo-status",err.message,true);}finally{button.disabled=false;}});
function initWellnessForms(){const d=isoToday();if($("#fit-date"))$("#fit-date").value=$("#fit-date").value||d;if($("#meal-date"))$("#meal-date").value=$("#meal-date").value||d;if($("#fit-exercises")&&!$("#fit-exercises").children.length)addExerciseRow();if($("#meal-foods")&&!$("#meal-foods").children.length)addFoodRow();}
initWellnessForms();

const exerciseLibraryState={items:[],lastQuery:""};

const exerciseFolderStorageKey="nuvem.fit.exercise-folders.v1";
let exerciseFolders=[];
let currentExerciseFolderId=null;
function loadExerciseFolders(){
  try{const raw=localStorage.getItem(exerciseFolderStorageKey);const parsed=raw?JSON.parse(raw):[];exerciseFolders=Array.isArray(parsed)?parsed.filter(f=>f&&typeof f.id==="string"&&typeof f.name==="string"&&Array.isArray(f.exercises)):[];}
  catch{exerciseFolders=[];}
}
function saveExerciseFolders(){
  try{localStorage.setItem(exerciseFolderStorageKey,JSON.stringify(exerciseFolders));setApiStatus("#exercise-folder-status","✓ Pastas salvas neste navegador.");return true;}
  catch{setApiStatus("#exercise-folder-status","Não foi possível salvar. Verifique o espaço disponível no navegador.",true);return false;}
}
function switchFitSubpage(name){
  document.querySelectorAll("#view-fit .fit-subview").forEach(el=>el.classList.toggle("active",el.id==="fit-subview-"+name));
  document.querySelectorAll("[data-fit-tab]").forEach(el=>el.classList.toggle("active",el.dataset.fitTab===(name==="folder-detail"?"folders":name)));
  const area=$("#view-fit");if(area)area.scrollIntoView({behavior:"smooth",block:"start"});
}
document.querySelectorAll("[data-fit-tab]").forEach(button=>button.addEventListener("click",()=>switchFitSubpage(button.dataset.fitTab)));

function switchDietSubpage(name){
  document.querySelectorAll("#view-dieta .fit-subview").forEach(el=>el.classList.toggle("active",el.id==="diet-subview-"+name));
  document.querySelectorAll("[data-diet-tab]").forEach(el=>el.classList.toggle("active",el.dataset.dietTab===name));
  $("#view-dieta")?.scrollIntoView({behavior:"smooth",block:"start"});
}
document.querySelectorAll("[data-diet-tab]").forEach(button=>button.addEventListener("click",()=>switchDietSubpage(button.dataset.dietTab)));

function renderExerciseFolders(){
  const area=$("#exercise-folder-list");if(!area)return;area.replaceChildren();
  if(!exerciseFolders.length){const empty=node("div","exercise-library-empty");const mark=node("span","exercise-folder-mark");mark.appendChild(createFolderIcon());empty.append(mark,node("strong","","Suas pastas começam aqui"),node("small","","Crie sua primeira pasta e depois adicione os exercícios que quiser."));area.appendChild(empty);return;}
  for(const folder of exerciseFolders){
    const card=node("article","exercise-folder-card"),icon=node("div","exercise-folder-icon"),body=node("div","exercise-folder-body"),title=node("h3","",folder.name),count=node("p","",folder.exercises.length+" exercício"+(folder.exercises.length===1?"":"s")),actions=node("div","exercise-folder-actions"),open=node("button","button button-primary","Abrir pasta →"),del=node("button","button button-quiet","Excluir");
    icon.appendChild(createFolderIcon());open.type=del.type="button";open.addEventListener("click",()=>openExerciseFolder(folder.id));del.addEventListener("click",()=>{if(!confirm("Excluir a pasta “"+folder.name+"” e os exercícios guardados nela?"))return;exerciseFolders=exerciseFolders.filter(item=>item.id!==folder.id);saveExerciseFolders();renderExerciseFolders();if(currentExerciseFolderId===folder.id){currentExerciseFolderId=null;switchFitSubpage("folders");}});
    body.append(title,count);actions.append(open,del);card.append(icon,body,actions);area.appendChild(card);
  }
}
function openExerciseFolder(id){
  const folder=exerciseFolders.find(item=>item.id===id);if(!folder)return;currentExerciseFolderId=id;
  $("#exercise-current-folder-title").textContent=folder.name;$("#exercise-current-folder-description").textContent="Adicione, consulte e organize os exercícios guardados nesta pasta.";
  $("#exercise-search-input").value="";$("#exercise-library-results").replaceChildren();$("#exercise-detail").hidden=true;
  setApiStatus("#exercise-search-status","Digite um exercício ou escolha uma pesquisa popular.");renderSavedExercises();switchFitSubpage("folder-detail");
}
function addExerciseToCurrentFolder(exercise){
  const folder=exerciseFolders.find(item=>item.id===currentExerciseFolderId);if(!folder)return setApiStatus("#exercise-search-status","Volte às pastas e abra uma pasta primeiro.",true);
  const key=String(exercise.id||exercise.name).toLowerCase();
  if(folder.exercises.some(item=>String(item.id||item.name).toLowerCase()===key||item.name===exercise.name)){setApiStatus("#exercise-search-status","Esse exercício já está nesta pasta.");return;}
  folder.exercises.push({...exercise,name:exercise.displayName||exercise.name});saveExerciseFolders();renderExerciseFolders();renderSavedExercises();setApiStatus("#exercise-search-status","✓ "+(exercise.displayName||exercise.name)+" foi guardado em “"+folder.name+"”.");
}
function renderSavedExercises(){
  const area=$("#exercise-folder-saved-list"),folder=exerciseFolders.find(item=>item.id===currentExerciseFolderId);if(!area||!folder)return;
  area.replaceChildren();$("#exercise-current-folder-count").textContent=folder.exercises.length+" exercício"+(folder.exercises.length===1?"":"s");
  if(!folder.exercises.length){area.appendChild(node("p","muted","Esta pasta ainda está vazia. Use a pesquisa abaixo para adicionar seu primeiro exercício."));return;}
  for(const exercise of folder.exercises){
    const card=node("article","exercise-saved-card"),media=node("div","exercise-saved-media"),img=document.createElement("img"),body=node("div","exercise-saved-body"),title=node("strong","",exercise.name||exercise.displayName),meta=node("small","", [exercise.group,exercise.equipment].filter(Boolean).join(" · ")),actions=node("div","exercise-saved-actions"),details=node("button","button button-quiet","Como fazer"),add=node("button","button button-secondary","＋ No treino"),remove=node("button","button button-quiet","Remover");
    if(exercise.gifUrl){img.src=exercise.gifUrl;img.alt="Demonstração de "+exercise.name;img.loading="eager";img.decoding="async";img.onerror=()=>{img.hidden=true;media.classList.add("exercise-image-missing");media.append(node("span","exercise-image-fallback","Demonstração indisponível"));};media.appendChild(img);}else {media.classList.add("exercise-image-missing");media.appendChild(node("span","exercise-image-fallback","Demonstração indisponível"));}
    details.type=add.type=remove.type="button";details.addEventListener("click",()=>showExerciseDetail(exercise));add.addEventListener("click",()=>{addExerciseRow({name:exercise.name,sets:3,reps:"8–12"});if(!$("#fit-title").value.trim())$("#fit-title").value="Treino do dia";setApiStatus("#fit-status","✓ "+exercise.name+" adicionado à sessão. Ajuste séries e repetições.");switchFitSubpage("builder");});remove.addEventListener("click",()=>{folder.exercises=folder.exercises.filter(item=>item!==exercise);saveExerciseFolders();renderExerciseFolders();renderSavedExercises();});
    body.append(title,meta);actions.append(details,add,remove);body.appendChild(actions);card.append(media,body);area.appendChild(card);
  }
}
$("#exercise-folder-form")?.addEventListener("submit",event=>{
  event.preventDefault();const input=$("#exercise-folder-name"),name=input.value.trim();if(!name)return;
  if(exerciseFolders.some(folder=>folder.name.toLocaleLowerCase("pt-BR")===name.toLocaleLowerCase("pt-BR"))){setApiStatus("#exercise-folder-status","Você já tem uma pasta com esse nome.",true);return;}
  const folder={id:crypto.randomUUID?.()||String(Date.now())+Math.random().toString(16).slice(2),name,exercises:[]};exerciseFolders.push(folder);
  if(saveExerciseFolders()){input.value="";renderExerciseFolders();openExerciseFolder(folder.id);}
});
$("#exercise-folder-back")?.addEventListener("click",()=>{currentExerciseFolderId=null;switchFitSubpage("folders");renderExerciseFolders();});
loadExerciseFolders();

function exerciseMeta(value){return Array.isArray(value)?value.filter(Boolean).join(", "):String(value||"");}
function drawExerciseSuggestions(items){
  const area=$("#exercise-library-results");if(!area)return;area.replaceChildren();
  if(!items.length){const empty=node("div","exercise-library-empty");empty.append(node("span","","⌕"),node("strong","","Nenhum resultado encontrado"),node("small","","Tente o nome popular em português, como supino reto, puxada alta, cadeira extensora ou rosca martelo."));area.appendChild(empty);return;}
  for(const exercise of items){
    const card=node("article","exercise-library-card"),media=node("div","exercise-card-media"),image=document.createElement("img"),body=node("div","exercise-card-body"),heading=node("div","exercise-card-heading"),title=node("h3","",exercise.displayName||exercise.name),group=node("span","exercise-group",exercise.group||"Exercício"),meta=node("p","exercise-card-meta",[exerciseMeta(exercise.targetMuscles),exerciseMeta(exercise.equipment)].filter(Boolean).join(" · "));
    image.src=exercise.gifUrl;image.alt="Demonstração animada de "+(exercise.displayName||exercise.name);image.loading="eager";image.decoding="async";image.onerror=()=>{image.hidden=true;media.classList.add("exercise-image-missing");media.append(node("span","exercise-image-fallback","Demonstração indisponível"));};
    media.appendChild(image);heading.append(title,group);body.append(heading,meta);
    const actions=node("div","exercise-card-actions"),details=node("button","button button-secondary","Ver como fazer"),add=node("button","button button-primary","＋ Guardar na pasta");
    details.type=add.type="button";
    details.addEventListener("click",()=>showExerciseDetail(exercise));
    add.addEventListener("click",()=>addExerciseToCurrentFolder(exercise));
    actions.append(details,add);body.append(actions);card.append(media,body);area.appendChild(card);
  }
}
function showExerciseDetail(exercise){
  const area=$("#exercise-detail");if(!area)return;area.replaceChildren();
  const top=node("div","exercise-detail-top"),title=node("div","",undefined),heading=node("h3","",exercise.displayName||exercise.name),sub=node("p","exercise-card-meta",[exercise.group,exercise.equipment].filter(Boolean).join(" · ")),close=node("button","exercise-detail-close","Fechar ×");
  title.append(heading,sub);close.type="button";close.addEventListener("click",()=>{area.hidden=true;});top.append(title,close);
  const layout=node("div","exercise-detail-layout"),visual=node("div","exercise-detail-visual"),image=document.createElement("img"),instructions=node("div","exercise-detail-instructions");
  image.src=exercise.gifUrl;image.alt="Demonstração do exercício "+(exercise.displayName||exercise.name);image.loading="eager";image.decoding="async";image.onerror=()=>{image.hidden=true;visual.classList.add("exercise-image-missing");visual.append(node("p","muted","Demonstração indisponível nesta conexão. Confira as instruções abaixo."));};visual.appendChild(image);
  instructions.appendChild(node("h4","","Como fazer"));
  const steps=Array.isArray(exercise.howTo)?exercise.howTo:[];if(steps.length){const list=document.createElement("ol");for(const step of steps)list.appendChild(node("li","",String(step)));instructions.appendChild(list);}else instructions.appendChild(node("p","muted","A fonte não retornou um passo a passo para este exercício. Comece com pouca carga e peça orientação a um profissional."));
  const cues=Array.isArray(exercise.cues)?exercise.cues:[];if(cues.length){instructions.appendChild(node("h4","","Pontos de atenção"));const list=document.createElement("ul");for(const cue of cues)list.appendChild(node("li","",String(cue)));instructions.appendChild(list);}
  const targets=[...(exercise.targetMuscles||[]),...(exercise.secondaryMuscles||[])].filter(Boolean);if(targets.length)instructions.appendChild(node("p","exercise-card-meta","Músculos indicados pela base: "+targets.join(", ")));
  layout.append(visual,instructions);area.append(top,layout);
  const folder=exerciseFolders.find(item=>item.id===currentExerciseFolderId),alreadySaved=!!folder&&folder.exercises.some(item=>String(item.id||item.name).toLowerCase()===String(exercise.id||exercise.name).toLowerCase()||item.name===exercise.name);const actions=node("div","exercise-detail-actions"),add=node("button","button button-primary",alreadySaved?"＋ Adicionar ao meu treino":"＋ Guardar nesta pasta");add.type="button";add.addEventListener("click",()=>{if(!alreadySaved)return addExerciseToCurrentFolder(exercise);addExerciseRow({name:exercise.displayName||exercise.name,sets:3,reps:"8–12"});if(!$("#fit-title").value.trim())$("#fit-title").value="Treino do dia";setApiStatus("#fit-status","✓ "+(exercise.displayName||exercise.name)+" adicionado à sessão.");switchFitSubpage("builder");});actions.appendChild(add);area.appendChild(actions);area.hidden=false;area.scrollIntoView({behavior:"smooth",block:"nearest"});
}
async function searchExercises(query){
  const search=String(query||"").trim();if(!search)return setApiStatus("#exercise-search-status","Digite um exercício ou escolha uma pesquisa popular.",true);
  const button=$("#exercise-search-submit");button.disabled=true;setApiStatus("#exercise-search-status","Buscando exercícios e demonstrações…");$("#exercise-detail").hidden=true;
  try{
    const data=await api("/api/app/exercises?search="+encodeURIComponent(search));exerciseLibraryState.items=data.exercises||[];exerciseLibraryState.lastQuery=search;drawExerciseSuggestions(exerciseLibraryState.items);
    const count=exerciseLibraryState.items.length;
    setApiStatus("#exercise-search-status",count?count+" resultado(s) para “"+search+"”. "+(data.notice||""):data.notice||"Nenhum resultado encontrado.",!count);
  }catch(error){drawExerciseSuggestions([]);setApiStatus("#exercise-search-status",error.message,true);}
  finally{button.disabled=!session;}
}
$("#exercise-search-form")?.addEventListener("submit",event=>{event.preventDefault();searchExercises($("#exercise-search-input")?.value);});
document.querySelectorAll("[data-exercise-query]").forEach(button=>button.addEventListener("click",()=>{const query=button.dataset.exerciseQuery||"";$("#exercise-search-input").value=query;searchExercises(query);}));


async function askWellnessAI(kind){const fit=kind==="fit",question=$(fit?"#fit-ai-question":"#meal-ai-question"),button=$(fit?"#fit-ai-submit":"#meal-ai-submit"),status=fit?"#fit-ai-status":"#meal-ai-status",result=fit?"#fit-ai-result":"#meal-ai-result";const text=question?.value.trim();if(!text)return setApiStatus(status,"Escreva sua pergunta primeiro.",true);button.disabled=true;setApiStatus(status,"A Nuvem está preparando uma sugestão…");$(result).hidden=true;try{const context=fit?"Você está na Área Fit da Nuvem. Dê uma sugestão geral de atividade/treino segura, adaptável ao nível iniciante e sem prometer resultados. Pergunte por limitações relevantes quando necessário, recomende técnica e descanso, e não faça diagnóstico médico. Pedido: ":"Você está na área Nutrição da Nuvem. Sugira combinações e ideias equilibradas sem demonizar alimentos, prescrever dieta restritiva, metas de calorias ou compensação por exercício. Se a pessoa mencionar alergias ou condição clínica, incentive confirmar orientações com profissional. Pedido: ";const response=await api("/api/app/chat",{method:"POST",body:JSON.stringify({content:context+text})});$(result).replaceChildren(node("h3","",fit?"Sugestão de treino":"Ideias para sua refeição"),node("p","meal-analysis-copy",response.message?.content||"A IA não retornou uma resposta."));$(result).hidden=false;setApiStatus(status,"Resposta pronta. Ela também fica salva no histórico do assistente.");await loadHistory();}catch(e){setApiStatus(status,e.message,true);}finally{button.disabled=false;}}
$("#fit-ai-form")?.addEventListener("submit",e=>{e.preventDefault();askWellnessAI("fit");});
$("#meal-ai-form")?.addEventListener("submit",e=>{e.preventDefault();askWellnessAI("meal");});


async function sendChat(event){
  event.preventDefault();if(busy||!session)return;
  const input=$("#chat-input"),button=$("#chat-send"),text=input.value.trim();
  if(!text)return;
  if(!activeChatId){setApiStatus("#chat-status","Crie uma conversa antes de enviar mensagens.",true);return;}
  if(text.length>4000){setApiStatus("#chat-status","Limite de 4000 caracteres por mensagem.",true);return;}
  busy=true;button.disabled=true;input.disabled=true;addChatMessage("user",text);updatePromptSuggestions(false);
  input.value="";input.style.height="auto";setApiStatus("#chat-status","Preparando sua resposta…");addTypingIndicator();
  try{
    const result=await api("/api/app/chat",{method:"POST",body:JSON.stringify({content:text,conversation_id:activeChatId})});
    removeTypingIndicator();addChatMessage("assistant",result.message.content);setApiStatus("#chat-status","Resposta salva nesta conversa.");
    await Promise.all([loadHistory(),refreshChatList()]);
  }catch(e){
    removeTypingIndicator();input.value=text;input.style.height="auto";setApiStatus("#chat-status",e.message,true);
    addChatMessage("assistant","Não consegui concluir essa mensagem. Seu texto foi mantido na caixa para você tentar novamente.");
  }finally{
    removeTypingIndicator();busy=false;button.disabled=!session;input.disabled=!session;input.focus();scrollChatToBottom(true);
  }
}
async function refreshChatList(){try{const data=await api("/api/app/chats");chatList=data.chats||[];renderChatList();const current=chatList.find(c=>c.id===activeChatId);if(current&&$("#chat-current-title"))$("#chat-current-title").textContent=current.title||"Nova conversa";}catch{}}
let allExpenses=[];
let filteredExpenses=[];
function getFilteredExpenses(expenses){
  const period=$("#expense-period")?.value||"month";
  const query=($("#expense-search")?.value||"").trim().toLocaleLowerCase("pt-BR");
  const now=new Date();
  let startDate=new Date(now.getFullYear(),now.getMonth(),1);
  if(period==="30")startDate=new Date(now.getTime()-30*86400000);
  if(period==="90")startDate=new Date(now.getTime()-90*86400000);
  if(period==="year")startDate=new Date(now.getFullYear(),0,1);
  const localDate=d=>{const date=new Date(d);return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");};
  return expenses.filter(e=>{
    const d=String(e.spent_at||"").slice(0,10);
    if(period!=="all"&&d<localDate(startDate))return false;
    return !query||(String(e.description||"")+" "+String(e.category||"")).toLocaleLowerCase("pt-BR").includes(query);
  }).sort((a,b)=>String(b.spent_at).localeCompare(String(a.spent_at))||String(b.created_at).localeCompare(String(a.created_at)));
}
function drawCategoryChart(expenses){
  const chart=$("#expense-category-chart");if(!chart)return;chart.replaceChildren();
  const sums={};for(const e of expenses)sums[e.category]=(sums[e.category]||0)+Number(e.amount);
  const entries=Object.entries(sums).sort((a,b)=>b[1]-a[1]).slice(0,7);
  if(!entries.length){chart.appendChild(node("p","muted","Ainda não há despesas neste período para montar o gráfico."));return;}
  const max=Math.max(...entries.map(x=>x[1]),1);
  for(const [name,value] of entries){const row=node("div","category-chart-row"),label=node("div","category-chart-label"),barTrack=node("div","category-chart-track"),bar=node("span","category-chart-bar"),amount=node("strong","category-chart-amount",esconderValoresFinanceiros?"R$ ••••••":formatBRL(value));amount.dataset.valorOriginal=formatBRL(value);label.append(node("span","",name),amount);bar.style.width=Math.max(3,value/max*100)+"%";barTrack.appendChild(bar);row.append(label,barTrack);chart.appendChild(row);}
}
function drawExpenses(expenses){
  allExpenses=expenses;
  filteredExpenses=getFilteredExpenses(allExpenses);
  const list=$("#expense-list");if(!list)return;list.replaceChildren();
  const total=filteredExpenses.reduce((sum,e)=>sum+Number(e.amount),0);
  const totalText=formatBRL(total);
  $("#expense-total").textContent=esconderValoresFinanceiros?"R$ ••••••":totalText;$("#expense-total").dataset.valorOriginal=totalText;
  $("#expense-count").textContent=esconderValoresFinanceiros?"••":String(filteredExpenses.length);$("#expense-count").dataset.valorOriginal=String(filteredExpenses.length);
  const categories={};for(const e of filteredExpenses)categories[e.category]=(categories[e.category]||0)+Number(e.amount);
  const top=Object.entries(categories).sort((a,b)=>b[1]-a[1])[0];$("#expense-category").textContent=top?top[0]:"—";
  const hero=$("#expense-total-hero");if(hero){hero.textContent=esconderValoresFinanceiros?"R$ ••••••":totalText;hero.dataset.valorOriginal=totalText;}
  drawCategoryChart(filteredExpenses);
  if(!filteredExpenses.length){list.appendChild(node("p","muted",allExpenses.length?"Nenhum lançamento corresponde aos filtros.":"Nenhuma despesa registrada ainda."));return;}
  for(const e of filteredExpenses.slice(0,100)){
    const row=node("div","expense-row"),info=node("div","expense-info"),title=node("strong","",e.description),meta=node("small","",e.category+" · "+new Date(e.spent_at+"T12:00:00").toLocaleDateString("pt-BR")),amount=node("strong","expense-amount",esconderValoresFinanceiros?"R$ ••••••":formatBRL(e.amount)),remove=node("button","expense-remove","Excluir");
    amount.dataset.valorOriginal=formatBRL(e.amount);info.append(title,meta);remove.type="button";
    remove.addEventListener("click",async()=>{if(!confirm("Excluir esta despesa?"))return;remove.disabled=true;try{await api("/api/app/expenses/"+encodeURIComponent(e.id),{method:"DELETE"});await loadExpenses();setApiStatus("#expense-status","Despesa excluída.");}catch(err){setApiStatus("#expense-status",err.message,true);remove.disabled=false;}});
    row.append(info,amount,remove);list.appendChild(row);
  }
}
async function loadExpenses(){
  try{const data=await api("/api/app/expenses");drawExpenses(data.expenses);}
  catch(e){setApiStatus("#expense-status","Finanças indisponíveis: "+e.message,true);}
}
async function addExpense(event){event.preventDefault();if(!session)return;const description=$("#expense-description").value.trim(),amount=Number($("#expense-amount").value);const button=$("#expense-submit");button.disabled=true;setApiStatus("#expense-status","Salvando…");try{await api("/api/app/expenses",{method:"POST",body:JSON.stringify({description,amount,spent_at:$("#expense-date")?.value||new Date().toISOString().slice(0,10),category:$("#expense-category-input")?.value||"Outros"})});$("#expense-form").reset();if($("#expense-date"))$("#expense-date").value=localDateHoje();await loadExpenses();setApiStatus("#expense-status","Despesa salva com segurança.");}catch(e){setApiStatus("#expense-status",e.message,true);}finally{button.disabled=false;}}
function setAuthenticatedUI(user){const logged=Boolean(user);$("#login-screen").hidden=logged;$("#logout-button").hidden=!logged;$("#chat-input").disabled=!logged;$("#chat-send").disabled=!logged;["#chat-new","#chat-delete","#chat-audio-button"].forEach(s=>{const el=$(s);if(el)el.disabled=!logged;});$("#expense-description").disabled=!logged;$("#expense-amount").disabled=!logged;const expenseDate=$("#expense-date");if(expenseDate)expenseDate.disabled=!logged;const cat=$("#expense-category-input");if(cat)cat.disabled=!logged;$("#expense-submit").disabled=!logged;["#reminder-title","#reminder-note","#reminder-time","#reminder-repeat","#reminder-date","#reminder-submit","#notification-enable","#fit-title","#fit-date","#fit-kind","#fit-notes","#fit-add-exercise","#fit-save","#fit-ai-question","#fit-ai-submit","#meal-ai-question","#meal-ai-submit","#meal-title","#meal-date","#meal-kind","#meal-notes","#meal-add-food","#meal-save","#meal-photo","#meal-photo-submit","#sticker-editor-file","#sticker-caption","#sticker-caption-color","#sticker-outline-color","#sticker-caption-size","#sticker-remove-bg","#sticker-add-pack","#sticker-send-current","#sticker-pack-name","#sticker-create-pack","#sticker-pack-select","#sticker-send-pack","#sticker-delete-pack","#sticker-video-file","#sticker-video-action","#sticker-video-submit","#audio-file","#audio-submit","#audio-search-query","#audio-search-submit","#audio-editor-file","#audio-trim-start","#audio-trim-end","#audio-trim-submit","#audio-link-url","#audio-link-submit","#chat-audio-file"].forEach(s=>{const el=$(s);if(el)el.disabled=!logged;});["#profile-name","#profile-assistant","#profile-language","#profile-style","#profile-save"].forEach(s=>{const el=$(s);if(el)el.disabled=!logged;});const label=$("#connection-label");if(label)label.textContent=logged?"Conta autenticada":"API ainda não conectada";setStickerEditorControls();}
async function loadProfile(){
  try{
    const data=await api("/api/app/me"),p=data.profile||{};
    $("#profile-name").value=p.display_name||"";$("#profile-assistant").value=p.assistant_name||"Nuvem";
    $("#profile-language").value=p.language||"pt-BR";$("#profile-style").value=p.response_style||"balanced";
    ["#profile-name","#profile-assistant","#profile-language","#profile-style","#profile-save"].forEach(s=>$(s).disabled=false);
    setApiStatus("#profile-status","Preferências carregadas.");
  }catch(e){setApiStatus("#profile-status","Perfil indisponível: "+e.message,true);}
}
async function saveProfile(event){event.preventDefault();if(!session)return;const button=$("#profile-save");button.disabled=true;setApiStatus("#profile-status","Salvando preferências…");try{await api("/api/app/me",{method:"PUT",body:JSON.stringify({display_name:$("#profile-name").value,assistant_name:$("#profile-assistant").value,language:$("#profile-language").value,response_style:$("#profile-style").value})});setApiStatus("#profile-status","Preferências salvas.");}catch(e){setApiStatus("#profile-status",e.message,true);}finally{button.disabled=false;}}
$("#profile-form").addEventListener("submit",saveProfile);
async function afterLogin(user){
  session=(await supabaseClient.auth.getSession()).data.session;
  if(!session){setAuthenticatedUI(null);return;}
  try{await api("/api/app/session");}
  catch(e){
    if(e.status===401||e.status===403){
      session=null;setAuthenticatedUI(null);
      try{await supabaseClient.auth.signOut();}catch{}
      setLoginStatus(e.message||"Esta conta não tem autorização para acessar o Nuvem.",true);return;
    }
    setAuthenticatedUI(user);
    setApiStatus("#chat-status","Não consegui validar a sessão no servidor. Confira sua conexão e tente novamente.",true);
    return;
  }
  setAuthenticatedUI(user);
  window.dispatchEvent(new Event("nuvem:authenticated"));
  setApiStatus("#chat-status","Carregando suas conversas…");
  const jobs=[loadProfile(),loadChats(),loadExpenses(),loadHistory(),loadReminders(),loadWellnessRecords()];
  const results=await Promise.allSettled(jobs);
  const failed=results.some(result=>result.status==="rejected");
  setLoginStatus(failed?"Você entrou, mas alguns recursos precisam de atenção.":"Sessão validada.");
  const input=$("#chat-input"),send=$("#chat-send");
  if(input)input.disabled=false;if(send)send.disabled=false;
}
async function startApp(){try{const configResponse=await fetch("/api/app/config",{cache:"no-store"});const config=await configResponse.json();if(!configResponse.ok)throw new Error(config.error||"O servidor ainda não foi configurado.");vapidPublicKey=config.vapidPublicKey||'';if(!window.supabase?.createClient)throw new Error("A biblioteca de autenticação não carregou. Verifique sua conexão.");supabaseClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});$("#login-status").textContent="Entre com o e-mail autorizado.";const {data:{session:current}}=await supabaseClient.auth.getSession();if(current){session=current;await afterLogin(current.user);}supabaseClient.auth.onAuthStateChange((_event,newSession)=>{if(newSession){session=newSession;setAuthenticatedUI(newSession.user);}else{session=null;setAuthenticatedUI(null);}});}catch(e){setLoginStatus(e.message,true);}}
$("#login-form").addEventListener("submit",async event=>{event.preventDefault();if(!supabaseClient){setLoginStatus("A autenticação ainda não está configurada no servidor.",true);return;}const button=$("#login-submit");button.disabled=true;setLoginStatus("Validando sua conta…");try{const {data,error}=await supabaseClient.auth.signInWithPassword({email:$("#login-email").value.trim(),password:$("#login-password").value});if(error)throw error;session=data.session;await afterLogin(data.user);}catch(e){setLoginStatus(e.message||"Não foi possível entrar.",true);}finally{button.disabled=false;}});
$("#logout-button").addEventListener("click",async()=>{if(supabaseClient)await supabaseClient.auth.signOut();session=null;setAuthenticatedUI(null);setLoginStatus("Você saiu da sua conta.");});
$("#chat-form").addEventListener("submit",sendChat);
const chatInput = $("#chat-input");
chatInput?.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 180) + "px";
});
chatInput?.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#chat-form")?.requestSubmit();
  }
});
$("#expense-form").addEventListener("submit",addExpense);
async function verificarBackend(){const label=$("#connection-label");try{const response=await fetch("/health",{headers:{Accept:"application/json"},cache:"no-store"});if(!response.ok)throw new Error();const data=await response.json();if(label&&!session)label.textContent=data.online?"Servidor acessível":"Servidor indisponível";}catch{if(label&&!session)label.textContent="API ainda não conectada";}}
verificarBackend();startApp();
const reminderForm = $("#reminder-form");
$("#reminder-repeat")?.addEventListener("change", () => { const once = $("#reminder-repeat").value === "once"; $("#reminder-date-wrap").hidden = !once; $("#reminder-date").required = once; });
function decodeVapidKey(value){const padded=value.padEnd(value.length+((4-value.length%4)%4),'=');const raw=atob(padded.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,ch=>ch.charCodeAt(0));}
$("#notification-enable")?.addEventListener("click", async () => {
  const button=$("#notification-enable");button.disabled=true;
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador não oferece notificações push. Tente instalar o app pelo Chrome ou Edge.");
    if (!vapidPublicKey) throw new Error("As notificações em segundo plano ainda não foram configuradas no servidor.");
    const permission=await Notification.requestPermission();
    if(permission!=="granted")throw new Error("Permissão não concedida. Ative as notificações nas configurações do navegador.");
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(vapidPublicKey)});
    await api("/api/app/push-subscriptions",{method:"POST",body:JSON.stringify({subscription:subscription.toJSON()})});
    setApiStatus("#reminder-status","Notificações em segundo plano ativadas neste dispositivo.");
  } catch(e) {setApiStatus("#reminder-status",e.message||"Não foi possível ativar notificações.",true);}
  finally {button.disabled=!session;}
});
async function loadReminders() { try { const data = await api("/api/app/reminders"); drawReminders(data.reminders || []); } catch(e) { const list=$("#reminder-list"); if(list) { list.replaceChildren(node("p","muted","Para ativar os lembretes, falta preparar a tabela segura no banco de dados.")); } setApiStatus("#reminder-status",e.message,true); } }
function drawReminders(items) { const list = $("#reminder-list"); if (!list) return; list.replaceChildren(); $("#reminder-count").textContent = items.filter(x => x.active).length + " ativos"; if (!items.length) { list.appendChild(node("p", "muted", "Você ainda não tem lembretes. Crie o primeiro ao lado.")); return; } for (const item of items) { const row=node("article","reminder-item"), icon=node("div","reminder-item-icon",item.repeat_daily?"↻":"◷"), body=node("div","reminder-item-body"), title=node("strong","",item.title), meta=node("small","",(item.repeat_daily?"Todos os dias":"Uma vez · "+item.remind_date)+" · "+item.remind_at.slice(0,5)+(item.note?" · "+item.note:"")), actions=node("div","reminder-actions"), toggle=node("button","reminder-toggle",item.active?"Pausar":"Ativar"), remove=node("button","expense-remove","Excluir"); body.append(title,meta); toggle.type=remove.type="button"; toggle.addEventListener("click",async()=>{toggle.disabled=true;try{await api("/api/app/reminders/"+encodeURIComponent(item.id),{method:"PATCH",body:JSON.stringify({active:!item.active})});await loadReminders();}catch(e){setApiStatus("#reminder-status",e.message,true);toggle.disabled=false;}}); remove.addEventListener("click",async()=>{if(!confirm("Excluir este lembrete?"))return;remove.disabled=true;try{await api("/api/app/reminders/"+encodeURIComponent(item.id),{method:"DELETE"});await loadReminders();}catch(e){setApiStatus("#reminder-status",e.message,true);remove.disabled=false;}}); actions.append(toggle,remove);row.append(icon,body,actions);list.appendChild(row); } }
reminderForm?.addEventListener("submit",async event=>{event.preventDefault();if(!session)return;const button=$("#reminder-submit");button.disabled=true;setApiStatus("#reminder-status","Salvando lembrete…");try{await api("/api/app/reminders",{method:"POST",body:JSON.stringify({title:$("#reminder-title").value,note:$("#reminder-note").value,remind_at:$("#reminder-time").value,repeat_daily:$("#reminder-repeat").value==="daily",remind_date:$("#reminder-date").value||null,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"America/Sao_Paulo"})});reminderForm.reset();$("#reminder-time").value="08:00";$("#reminder-date-wrap").hidden=true;await loadReminders();setApiStatus("#reminder-status","Lembrete salvo com sucesso.");}catch(e){setApiStatus("#reminder-status",e.message,true);}finally{button.disabled=false;}});
if("serviceWorker"in navigator&&location.protocol==="https:")window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
let esconderValoresFinanceiros=false;
function atualizarVisibilidadeFinanceira(){const ids=["#expense-total-hero","#expense-total","#expense-count"];for(const id of ids){const el=$(id);if(!el)continue;if(!el.dataset.valorOriginal)el.dataset.valorOriginal=el.textContent;el.textContent=esconderValoresFinanceiros?(id==="#expense-count"?"••":"R$ ••••••"):el.dataset.valorOriginal;}document.querySelectorAll(".expense-amount,.category-chart-amount").forEach(el=>{if(!el.dataset.valorOriginal)el.dataset.valorOriginal=el.textContent;el.textContent=esconderValoresFinanceiros?"R$ ••••••":el.dataset.valorOriginal;});const button=$("#finance-eye");if(button){button.textContent=esconderValoresFinanceiros?"◌":"◉";button.setAttribute("aria-pressed",String(esconderValoresFinanceiros));button.setAttribute("aria-label",esconderValoresFinanceiros?"Mostrar valores":"Ocultar valores");}}
$("#finance-eye")?.addEventListener("click",()=>{esconderValoresFinanceiros=!esconderValoresFinanceiros;atualizarVisibilidadeFinanceira();});


// Nuvem Studio: uploads go directly to authenticated endpoints and are not persisted.
function identificarTipoArquivo(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const ext = String(file?.name || "").split(".").pop().toLowerCase();
  if (["jpg","jpeg","png","webp","gif","avif","tif","tiff","heic","heif"].includes(ext)) return "image";
  if (["mp4","m4v","mov","webm","mkv","avi","3gp","mpeg"].includes(ext)) return "video";
  if (["mp3","wav","ogg","oga","flac","m4a","aac","opus","aiff"].includes(ext)) return "audio";
  return "unknown";
}
async function enviarArquivoParaDownload(path, file, statusSelector, button, fallbackName, sendToWhatsApp = false) {
  if (!session?.access_token || !file) { setApiStatus(statusSelector, "Entre na sua conta e escolha um arquivo primeiro.", true); return; }
  if (file.size === 0) { setApiStatus(statusSelector, "Esse arquivo está vazio. Escolha outro arquivo.", true); return; }
  if (file.size > 12 * 1024 * 1024) { setApiStatus(statusSelector, "O limite é 12 MB por arquivo.", true); return; }
  button.disabled = true;
  setApiStatus(statusSelector, "Enviando e processando o arquivo…");
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { Authorization: "Bearer " + session.access_token, "Content-Type": file.type || "application/octet-stream" },
      body: file,
      cache: "no-store"
    });
    if (!response.ok) {
      let message = "";
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try { const body = await response.json(); message = body.error || ""; } catch {}
      } else {
        try { message = (await response.text()).slice(0, 240); } catch {}
      }
      if (!message || /<!doctype html|<html/i.test(message)) {
        message = response.status === 401 ? "Sua sessão expirou. Entre novamente." :
          response.status === 413 ? "O arquivo passou do limite permitido de 12 MB." :
          response.status === 429 ? "Você usou muitas conversões em pouco tempo. Aguarde um minuto." :
          "O servidor não conseguiu processar o arquivo (erro " + response.status + "). Tente um arquivo menor ou de outro formato.";
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error("O servidor retornou um arquivo vazio.");
    const disposition = response.headers.get("content-disposition") || "";
    const name = disposition.match(/filename="([^"]+)"/i)?.[1] || fallbackName;
    if (sendToWhatsApp) {
      setApiStatus(statusSelector, "Figurinha criada. Enviando ao WhatsApp…");
      try {
        const sendResponse = await fetch("/api/app/media/sticker/send", {
          method: "POST",
          headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "image/webp" },
          body: blob,
          cache: "no-store"
        });
        let sendBody = {};
        try { sendBody = await sendResponse.json(); } catch {}
        if (sendResponse.ok) {
          setApiStatus(statusSelector, "✓ Figurinha enviada diretamente ao seu WhatsApp.");
          return;
        }
        throw new Error(sendBody.error || "O WhatsApp não confirmou o envio.");
      } catch (sendError) {
        const url = URL.createObjectURL(blob);
        const link = node("a", "", "Baixar figurinha");
        link.href = url;
        link.download = name;
        link.className = "button button-secondary media-download-link";
        link.style.display = "inline-flex";
        link.style.marginTop = "10px";
        document.body.appendChild(link);
        link.click();
        setApiStatus(statusSelector, "Não consegui enviar ao WhatsApp: " + (sendError.message || "erro de conexão") + " A figurinha foi baixada como alternativa.", true);
        window.setTimeout(() => link.remove(), 60_000);
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = node("a", "", "Baixar arquivo");
    link.href = url;
    link.download = name;
    link.className = "button button-primary media-download-link";
    link.style.display = "inline-flex";
    link.style.marginTop = "10px";
    document.body.appendChild(link);
    link.click();
    setApiStatus(statusSelector, "Conversão concluída. Se o download não abriu, use o botão abaixo.");
    window.setTimeout(() => link.remove(), 60_000);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    setApiStatus(statusSelector, error.message || "Erro ao processar arquivo.", true);
  } finally {
    button.disabled = !session?.access_token;
  }
}

const STICKER_PACKS_KEY = "nuvem-sticker-packs-v1";
const MAX_STICKERS_PER_PACK = 8;
let stickerSourceImage = null;
let stickerOriginalCanvas = null;
let stickerBackgroundRemoved = false;
let stickerPreviewReady = false;
let stickerPacks = loadStickerPacks();

function loadStickerPacks() {
  try {
    const data = JSON.parse(localStorage.getItem(STICKER_PACKS_KEY) || "[]");
    return Array.isArray(data) ? data.filter(pack => pack && typeof pack.id === "string" && typeof pack.name === "string" && Array.isArray(pack.stickers)).map(pack => ({...pack, stickers: pack.stickers.filter(item => item && typeof item.dataUrl === "string").slice(0, MAX_STICKERS_PER_PACK)})) : [];
  } catch { return []; }
}
function persistStickerPacks() {
  try {
    localStorage.setItem(STICKER_PACKS_KEY, JSON.stringify(stickerPacks));
    return true;
  } catch {
    setApiStatus("#sticker-pack-status", "O armazenamento deste navegador está cheio. Exclua algumas figurinhas ou crie um pacote menor.", true);
    return false;
  }
}
function selectedStickerPack() {
  const id = $("#sticker-pack-select")?.value;
  return stickerPacks.find(pack => pack.id === id) || null;
}
function renderStickerPacks() {
  const select = $("#sticker-pack-select");
  const grid = $("#sticker-pack-grid");
  const count = $("#sticker-pack-count");
  if (!select || !grid) return;
  const previous = select.value;
  select.replaceChildren();
  if (!stickerPacks.length) {
    const option = node("option", "", "Crie um pacote primeiro");
    option.value = "";
    select.appendChild(option);
  } else {
    for (const pack of stickerPacks) {
      const option = node("option", "", pack.name + " (" + pack.stickers.length + "/" + MAX_STICKERS_PER_PACK + ")");
      option.value = pack.id;
      select.appendChild(option);
    }
    if (stickerPacks.some(pack => pack.id === previous)) select.value = previous;
  }
  if (count) count.textContent = stickerPacks.length + (stickerPacks.length === 1 ? " pacote" : " pacotes");
  const pack = selectedStickerPack();
  grid.replaceChildren();
  if (!pack || !pack.stickers.length) {
    const empty = node("div", "sticker-pack-empty", pack ? "Este pacote ainda está vazio. Adicione uma figurinha pelo editor." : "Crie um pacote para guardar suas figurinhas.");
    grid.appendChild(empty);
  } else {
    pack.stickers.forEach((sticker, index) => {
      const item = node("div", "sticker-pack-item");
      const image = node("img", "sticker-pack-thumb");
      image.src = sticker.dataUrl;
      image.alt = sticker.caption || "Figurinha " + (index + 1);
      image.loading = "lazy";
      const meta = node("small", "", sticker.caption || "Figurinha " + (index + 1));
      const remove = node("button", "sticker-remove-item", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remover figurinha " + (index + 1));
      remove.addEventListener("click", () => {
        const current = selectedStickerPack();
        if (!current) return;
        current.stickers.splice(index, 1);
        if (persistStickerPacks()) { renderStickerPacks(); setApiStatus("#sticker-pack-status", "Figurinha removida do pacote."); }
      });
      item.append(image, meta, remove);
      grid.appendChild(item);
    });
  }
  const logged = Boolean(session?.access_token);
  const hasPack = Boolean(pack);
  $("#sticker-add-pack").disabled = !logged || !stickerPreviewReady || !hasPack || pack.stickers.length >= MAX_STICKERS_PER_PACK;
  $("#sticker-send-pack").disabled = !logged || !hasPack || !pack.stickers.length;
  $("#sticker-delete-pack").disabled = !logged || !hasPack;
}
function setStickerEditorControls() {
  const logged = Boolean(session?.access_token);
  ["#sticker-editor-file","#sticker-caption","#sticker-caption-color","#sticker-outline-color","#sticker-caption-size","#sticker-remove-bg","#sticker-undo-bg","#sticker-create-pack","#sticker-pack-name","#sticker-pack-select","#sticker-video-file","#sticker-video-action","#sticker-video-submit"].forEach(selector => {
    const el = $(selector);
    if (el) el.disabled = !logged;
  });
  $("#sticker-send-current").disabled = !logged || !stickerPreviewReady;
  renderStickerPacks();
}
function drawImageContained(context, image, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale, h = image.height * scale;
  context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}
function removeSmartBackground(canvas, tolerance = 42) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const width = canvas.width, height = canvas.height;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data, count = width * height;
  const visited = new Uint8Array(count), queue = new Int32Array(count);
  const dist = (a,b) => {
    const dr=data[a]-data[b], dg=data[a+1]-data[b+1], db=data[a+2]-data[b+2];
    return Math.sqrt(dr*dr*0.9 + dg*dg*1.15 + db*db*0.8);
  };
  const borderSamples=[];
  const stride=4;
  for(let x=0;x<width;x+=stride){borderSamples.push((x)*4,((height-1)*width+x)*4);}
  for(let y=stride;y<height-stride;y+=stride){borderSamples.push((y*width)*4,(y*width+width-1)*4);}
  if(!borderSamples.length)return false;
  const edge=[0,0,0];for(const i of borderSamples){edge[0]+=data[i];edge[1]+=data[i+1];edge[2]+=data[i+2];}
  edge[0]/=borderSamples.length;edge[1]/=borderSamples.length;edge[2]/=borderSamples.length;
  const seeds=[];
  for(const i of borderSamples){const d=Math.hypot(data[i]-edge[0],data[i+1]-edge[1],data[i+2]-edge[2]);if(d<115)seeds.push(i>>2);}
  let head=0,tail=0;
  const add=(p)=>{if(p>=0&&p<count&&!visited[p]){visited[p]=1;queue[tail++]=p;}};
  for(const p of seeds)add(p);
  const soft=[];
  while(head<tail){
    const p=queue[head++],i=p*4;
    if(data[i+3]<8)continue;
    const globalDistance=Math.hypot(data[i]-edge[0],data[i+1]-edge[1],data[i+2]-edge[2]);
    const x=p%width,y=(p/width)|0;
    let neighbourDistance=Infinity;
    if(x>0)neighbourDistance=Math.min(neighbourDistance,dist(i,(p-1)*4));
    if(x+1<width)neighbourDistance=Math.min(neighbourDistance,dist(i,(p+1)*4));
    if(y>0)neighbourDistance=Math.min(neighbourDistance,dist(i,(p-width)*4));
    if(y+1<height)neighbourDistance=Math.min(neighbourDistance,dist(i,(p+width)*4));
    const threshold=tolerance+(globalDistance>65? -8:8);
    if(globalDistance>142 || (globalDistance>90 && neighbourDistance>tolerance*1.65))continue;
    if(globalDistance>threshold && neighbourDistance>tolerance)continue;
    const alpha=data[i+3];
    if(globalDistance<tolerance*0.72)data[i+3]=0;
    else data[i+3]=Math.min(alpha,Math.max(0,Math.round(255*(globalDistance-tolerance*0.55)/(tolerance*0.9))));
    soft.push(p);
    if(x>0)add(p-1);if(x+1<width)add(p+1);if(y>0)add(p-width);if(y+1<height)add(p+width);
  }
  if(!soft.length)return false;
  // Remove the light/dark fringe left by antialiasing along the cut.
  for(const p of soft){const i=p*4;if(data[i+3]===0)continue;const a=data[i+3]/255;if(a<0.92){data[i]=Math.max(0,Math.min(255,Math.round((data[i]-edge[0]*(1-a))/Math.max(a,0.08))));data[i+1]=Math.max(0,Math.min(255,Math.round((data[i+1]-edge[1]*(1-a))/Math.max(a,0.08))));data[i+2]=Math.max(0,Math.min(255,Math.round((data[i+2]-edge[2]*(1-a))/Math.max(a,0.08))));}}
  context.putImageData(image,0,0);
  return true;
}
function renderStickerPreview() {
  const preview = $("#sticker-preview");
  if (!preview || !stickerOriginalCanvas) return;
  const context = preview.getContext("2d");
  context.clearRect(0, 0, 512, 512);
  context.drawImage(stickerOriginalCanvas, 0, 0);
  const caption = ($("#sticker-caption")?.value || "").trim().slice(0, 80);
  if (caption) {
    const color = $("#sticker-caption-color")?.value || "#ffffff";
    const outline = $("#sticker-outline-color")?.value || "#111111";
    const size = Number($("#sticker-caption-size")?.value || 34);
    context.font = "900 " + size + "px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.lineJoin = "round";
    const words = caption.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? line + " " + word : word;
      if (context.measureText(next).width > 470 && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    const visible = lines.slice(-3);
    const lineHeight = size * 1.08;
    let y = 494 - (visible.length - 1) * lineHeight;
    for (const textLine of visible) {
      context.strokeStyle = outline;
      context.lineWidth = Math.max(3, size / 7);
      context.strokeText(textLine, 256, y, 470);
      context.fillStyle = color;
      context.fillText(textLine, 256, y, 470);
      y -= lineHeight;
    }
  }
  stickerPreviewReady = true;
  $("#sticker-preview-empty").hidden = true;
  $("#sticker-send-current").disabled = !session?.access_token;
  renderStickerPacks();
}
function readStickerFile(file) {
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { setApiStatus("#sticker-editor-status", "O limite é 12 MB por imagem.", true); return; }
  if (identificarTipoArquivo(file) !== "image") { setApiStatus("#sticker-editor-status", "Escolha uma imagem. Para animadas, use o campo de vídeo abaixo.", true); return; }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    stickerSourceImage = image;
    stickerOriginalCanvas = document.createElement("canvas");
    stickerOriginalCanvas.width = stickerOriginalCanvas.height = 512;
    drawImageContained(stickerOriginalCanvas.getContext("2d"), image, 512, 512);
    stickerBackgroundRemoved = false;
    $("#sticker-undo-bg").disabled = true;
    $("#sticker-remove-bg").disabled = false;
    $("#sticker-caption").disabled = false;
    $("#sticker-caption-color").disabled = false;
    $("#sticker-outline-color").disabled = false;
    $("#sticker-caption-size").disabled = false;
    setApiStatus("#sticker-editor-status", "Imagem carregada. Edite o texto e confira a prévia.");
    renderStickerPreview();
  };
  image.onerror = () => { URL.revokeObjectURL(objectUrl); setApiStatus("#sticker-editor-status", "Não consegui abrir essa imagem. Tente outro arquivo.", true); };
  image.src = objectUrl;
}
async function exportStickerBlob() {
  const canvas = $("#sticker-preview");
  if (!canvas || !stickerPreviewReady) throw new Error("Escolha uma imagem para criar a figurinha.");
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.78));
  if (!blob || blob.type !== "image/webp") throw new Error("Este navegador não conseguiu criar uma figurinha WEBP. Tente usar Chrome ou Edge atualizado.");
  if (blob.size > 1_000_000) throw new Error("A figurinha ficou acima de 1 MB. Reduza o texto ou escolha uma imagem mais simples.");
  return blob;
}
async function sendStickerBlob(blob) {
  if (!session?.access_token) throw new Error("Entre na Nuvem novamente.");
  const response = await fetch("/api/app/media/sticker/send", { method: "POST", headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "image/webp" }, body: blob, cache: "no-store" });
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result.error || "Não consegui enviar ao WhatsApp.");
  return result;
}
async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não consegui preparar a figurinha para guardar no pacote."));
    reader.readAsDataURL(blob);
  });
}
$("#sticker-editor-file")?.addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (file) readStickerFile(file);
});
["#sticker-caption","#sticker-caption-color","#sticker-outline-color","#sticker-caption-size"].forEach(selector => $(selector)?.addEventListener("input", renderStickerPreview));
$("#chat-input")?.addEventListener("input",event=>{event.target.style.height="auto";event.target.style.height=Math.min(event.target.scrollHeight,180)+"px";});
$("#chat-input")?.addEventListener("keydown",event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();$("#chat-form")?.requestSubmit();}});
document.querySelectorAll("[data-prompt]").forEach(button=>button.addEventListener("click",()=>{const input=$("#chat-input");if(!input||input.disabled)return;input.value=button.dataset.prompt||"";input.focus();input.dispatchEvent(new Event("input",{bubbles:true}));}));
$("#sticker-remove-bg")?.addEventListener("click", () => {
  if (!stickerOriginalCanvas) return;
  try {
    const edited = document.createElement("canvas");
    edited.width = edited.height = 512;
    edited.getContext("2d").drawImage(stickerOriginalCanvas, 0, 0);
    if (!removeSmartBackground(edited, 42)) throw new Error("Não consegui identificar uma área de fundo conectada às bordas. Tente uma imagem com mais contraste.");
    stickerOriginalCanvas = edited;
    stickerBackgroundRemoved = true;
    $("#sticker-undo-bg").disabled = false;
    setApiStatus("#sticker-editor-status", "Fundo uniforme removido. Confira as bordas antes de enviar.");
    renderStickerPreview();
  } catch (error) { setApiStatus("#sticker-editor-status", error.message || "Não consegui remover o fundo.", true); }
});
$("#sticker-undo-bg")?.addEventListener("click", () => {
  if (!stickerSourceImage) return;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  drawImageContained(canvas.getContext("2d"), stickerSourceImage, 512, 512);
  stickerOriginalCanvas = canvas;
  stickerBackgroundRemoved = false;
  $("#sticker-undo-bg").disabled = true;
  setApiStatus("#sticker-editor-status", "Recorte desfeito.");
  renderStickerPreview();
});
$("#sticker-create-pack")?.addEventListener("click", () => {
  const name = ($("#sticker-pack-name")?.value || "").trim().replace(/\s+/g, " ").slice(0, 48);
  if (!name) return setApiStatus("#sticker-pack-status", "Digite um nome para o pacote.", true);
  if (stickerPacks.some(pack => pack.name.toLowerCase() === name.toLowerCase())) return setApiStatus("#sticker-pack-status", "Você já tem um pacote com esse nome.", true);
  const pack = { id: (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2)), name, stickers: [] };
  stickerPacks.push(pack);
  if (!persistStickerPacks()) { stickerPacks.pop(); return; }
  $("#sticker-pack-name").value = "";
  renderStickerPacks();
  $("#sticker-pack-select").value = pack.id;
  renderStickerPacks();
  setApiStatus("#sticker-pack-status", "Pacote criado neste navegador.");
});
$("#sticker-pack-select")?.addEventListener("change", renderStickerPacks);
$("#sticker-add-pack")?.addEventListener("click", async () => {
  const pack = selectedStickerPack();
  if (!pack) return setApiStatus("#sticker-pack-status", "Crie ou selecione um pacote primeiro.", true);
  if (pack.stickers.length >= MAX_STICKERS_PER_PACK) return setApiStatus("#sticker-pack-status", "Cada pacote aceita até 8 figurinhas nesta versão.", true);
  const button = $("#sticker-add-pack");
  button.disabled = true;
  try {
    const blob = await exportStickerBlob();
    const dataUrl = await blobToDataUrl(blob);
    pack.stickers.push({ id: (crypto.randomUUID?.() || String(Date.now())), dataUrl, caption: ($("#sticker-caption")?.value || "").trim().slice(0, 80) });
    if (!persistStickerPacks()) { pack.stickers.pop(); return; }
    renderStickerPacks();
    setApiStatus("#sticker-pack-status", "Figurinha adicionada a “" + pack.name + "”.");
    setApiStatus("#sticker-editor-status", "Figurinha guardada no pacote. Você ainda pode enviá-la ao WhatsApp.");
  } catch (error) { setApiStatus("#sticker-editor-status", error.message, true); }
  finally { button.disabled = !session?.access_token || !stickerPreviewReady || !selectedStickerPack() || selectedStickerPack().stickers.length >= MAX_STICKERS_PER_PACK; }
});
$("#sticker-send-current")?.addEventListener("click", async () => {
  const button = $("#sticker-send-current");
  button.disabled = true;
  setApiStatus("#sticker-editor-status", "Preparando e enviando a figurinha…");
  try {
    const blob = await exportStickerBlob();
    await sendStickerBlob(blob);
    setApiStatus("#sticker-editor-status", "✓ Figurinha enviada diretamente ao WhatsApp.");
  } catch (error) { setApiStatus("#sticker-editor-status", error.message || "Falha no envio.", true); }
  finally { button.disabled = !session?.access_token || !stickerPreviewReady; }
});
$("#sticker-send-pack")?.addEventListener("click", async () => {
  const pack = selectedStickerPack();
  if (!pack?.stickers.length) return setApiStatus("#sticker-pack-status", "Este pacote ainda não tem figurinhas.", true);
  const button = $("#sticker-send-pack");
  button.disabled = true;
  let sent = 0;
  setApiStatus("#sticker-pack-status", "Enviando pacote “" + pack.name + "”…");
  try {
    for (const sticker of pack.stickers) {
      const response = await fetch(sticker.dataUrl);
      const blob = await response.blob();
      await sendStickerBlob(blob);
      sent++;
    }
    setApiStatus("#sticker-pack-status", "✓ " + sent + " figurinhas enviadas ao WhatsApp como mensagens.");
  } catch (error) {
    setApiStatus("#sticker-pack-status", sent + " de " + pack.stickers.length + " enviadas. " + (error.message || "O envio parou."), true);
  } finally { renderStickerPacks(); }
});
$("#sticker-delete-pack")?.addEventListener("click", () => {
  const pack = selectedStickerPack();
  if (!pack) return;
  stickerPacks = stickerPacks.filter(item => item.id !== pack.id);
  if (persistStickerPacks()) { renderStickerPacks(); setApiStatus("#sticker-pack-status", "Pacote excluído deste navegador."); }
});
$("#sticker-video-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const file=$("#sticker-video-file")?.files?.[0],button=$("#sticker-video-submit"),action=$("#sticker-video-action")?.value||"send";
  if(!file)return setApiStatus("#sticker-video-status","Escolha um vídeo primeiro.",true);
  if(identificarTipoArquivo(file)!=="video")return setApiStatus("#sticker-video-status","Escolha um arquivo de vídeo compatível.",true);
  if(action==="pack"&&!selectedStickerPack())return setApiStatus("#sticker-video-status","Crie ou selecione um pacote antes de adicionar a animada.",true);
  button.disabled=true;setApiStatus("#sticker-video-status","Convertendo vídeo em figurinha animada…");
  try{
    const response=await fetch("/api/app/media/sticker-video",{method:"POST",headers:{Authorization:"Bearer "+session.access_token,"Content-Type":file.type||"application/octet-stream"},body:file,cache:"no-store"});
    if(!response.ok){let body={};try{body=await response.json()}catch{}throw new Error(body.error||"Não consegui converter o vídeo.");}
    const blob=await response.blob();if(!blob.size)throw new Error("O servidor retornou uma figurinha vazia.");
    if(action==="pack"){
      if(blob.size>1_000_000)throw new Error("A animada passou de 1 MB e não pode ser guardada como figurinha.");
      const pack=selectedStickerPack();if(!pack)throw new Error("Selecione um pacote novamente.");
      if(pack.stickers.length>=MAX_STICKERS_PER_PACK)throw new Error("O pacote já atingiu o limite de 8 figurinhas.");
      const dataUrl=await blobToDataUrl(blob);pack.stickers.push({id:(crypto.randomUUID?.()||String(Date.now())),dataUrl,caption:"Figurinha animada",animated:true});
      if(!persistStickerPacks()){pack.stickers.pop();return;}
      renderStickerPacks();setApiStatus("#sticker-video-status","✓ Figurinha animada adicionada ao pacote “"+pack.name+"”.");
    }else{
      await sendStickerBlob(blob);setApiStatus("#sticker-video-status","✓ Figurinha animada enviada individualmente ao WhatsApp.");
    }
  }catch(error){setApiStatus("#sticker-video-status",error.message||"Falha ao criar figurinha animada.",true);}
  finally{button.disabled=!session?.access_token;}
});

$("#audio-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const file = $("#audio-file")?.files?.[0];
  if (!file) return setApiStatus("#audio-status", "Escolha um vídeo ou áudio.", true);
  if (!["video", "audio"].includes(identificarTipoArquivo(file))) return setApiStatus("#audio-status", "Formato não reconhecido. Escolha MP3, WAV, M4A, MP4, MOV ou WEBM.", true);
  await enviarArquivoParaDownload("/api/app/media/audio", file, "#audio-status", $("#audio-submit"), "nuvem-audio.mp3");
});
let audioEditBlob = null;
let audioEditObjectUrl = "";
function abrirEditorAudio(item, modo = "edit") {
  const params = new URLSearchParams();
  if (item?.title) params.set("title", String(item.title).slice(0, 180));
  if (item?.url) params.set("source", item.url);
  if (modo === "send") params.set("action", "send");
  const tab = window.open("/app/audio-editor" + (params.size ? "?" + params.toString() : ""), "_blank");
  if (tab) tab.opener = null;
  else setApiStatus("#audio-search-status", "O navegador bloqueou a nova aba. Permita pop-ups para abrir o editor.", true);
}
function baixarResultadoAudio(item, button) {
  if (!session?.access_token) return setApiStatus("#audio-search-status", "Entre na sua conta para abrir o editor.", true);
  abrirEditorAudio(item, "edit");
}

async function enviarResultadoAudioWhatsapp(item, button) {
  if (!session?.access_token) return setApiStatus("#audio-search-status", "Entre na sua conta para enviar áudio.", true);
  if (!item?.downloadable || !item?.url) { abrirEditorAudio(item, "send"); return; }
  if (!confirm("Enviar este arquivo de áudio diretamente para o WhatsApp conectado?")) return;
  button.disabled = true; const previous = button.textContent; button.textContent = "Enviando…";
  try {
    const source = new URL(item.url); const allowed = source.protocol === "https:" && (source.hostname === "upload.wikimedia.org" || source.hostname === "archive.org");
    if (!allowed) throw new Error("Esta fonte não permite envio direto. Abra o editor para importar um arquivo compatível.");
    const response = await fetch("/api/app/media/audio/download", { method:"POST", headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"application/json"}, body:JSON.stringify({url:source.href}), cache:"no-store" });
    if (!response.ok) { let body={}; try { body=await response.json(); } catch {} throw new Error(body.error || "Não foi possível obter o arquivo original. Abra o editor."); }
    const blob = await response.blob();
    if (!blob.size || blob.size > 12*1024*1024) throw new Error("O arquivo precisa ter até 12 MB para envio direto. Use o editor para cortar um trecho.");
    const result = await fetch("/api/app/media/audio/send", { method:"POST", headers:{Authorization:"Bearer "+session.access_token,"Content-Type":blob.type||"application/octet-stream"}, body:blob, cache:"no-store" });
    let body={}; try { body=await result.json(); } catch {}
    if (!result.ok) throw new Error(body.error || "Não foi possível enviar o áudio.");
    setApiStatus("#audio-search-status", body.message || "Áudio enviado ao WhatsApp conectado.");
  } catch (error) { setApiStatus("#audio-search-status", error.message || "Falha ao enviar o áudio.", true); }
  finally { button.disabled = false; button.textContent = previous; }
}
function desenharResultadosAudio(results) {
  const area = $("#audio-search-results"); if (!area) return; area.replaceChildren();
  if (!results.length) { area.appendChild(node("div", "audio-empty-state", "Não encontrei resultados desta vez. Tente outro termo ou pesquise também em inglês.")); return; }
  let shown = 0;
  for (const item of results) {
    let url; try { url = new URL(item.url); } catch { continue; }
    if (url.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const trusted = ["youtube.com","m.youtube.com","music.youtube.com","youtu.be","youtube-nocookie.com","soundcloud.com","m.soundcloud.com","upload.wikimedia.org","archive.org"].includes(host); if (!trusted) continue;
    const card = node("article", "media-result audio-result-card"); const media = node("div", "audio-result-media"); let thumbnailUrl = "";
    try { const candidate = new URL(item.thumbnail || ""); const imageHost = candidate.hostname.toLowerCase().replace(/^www\./, ""); const validImageHost = ["i.ytimg.com","img.youtube.com","upload.wikimedia.org","archive.org"].includes(imageHost) || imageHost.endsWith(".sndcdn.com") || imageHost === "soundcloud.com"; if (candidate.protocol === "https:" && validImageHost) thumbnailUrl = candidate.href; } catch {}
    if (!thumbnailUrl && item.embedUrl) {
      try {
        const candidate = new URL(item.embedUrl);
        const match = candidate.hostname === "www.youtube-nocookie.com" ? candidate.pathname.match(/^\/embed\/([\w-]{11})$/) : null;
        if (candidate.protocol === "https:" && match) thumbnailUrl = "https://i.ytimg.com/vi/" + match[1] + "/hqdefault.jpg";
      } catch {}
    }
    if (thumbnailUrl) {
      const image = document.createElement("img");
      image.src = thumbnailUrl; image.alt = "Capa de " + (item.title || "resultado"); image.loading = "lazy"; image.decoding = "async";
      image.onerror = () => {
        if (image.dataset.fallbackTried !== "1" && item.embedUrl) {
          try {
            const candidate = new URL(item.embedUrl);
            const match = candidate.hostname === "www.youtube-nocookie.com" ? candidate.pathname.match(/^\/embed\/([\w-]{11})$/) : null;
            if (candidate.protocol === "https:" && match) { image.dataset.fallbackTried = "1"; image.src = "https://i.ytimg.com/vi/" + match[1] + "/mqdefault.jpg"; return; }
          } catch {}
        }
        image.remove(); media.classList.add("audio-result-media-fallback");
        media.replaceChildren(node("span", "audio-cover-unavailable", "Capa indisponível"));
      };
      media.appendChild(image);
    } else {
      media.classList.add("audio-result-media-fallback");
      media.appendChild(node("span", "audio-cover-unavailable", "Prévia indisponível"));
    }
    const content = node("div", "audio-result-content"); const details = node("div", "media-result-details");
    details.append(node("strong", "", item.title || "Áudio sem título"), node("small", "audio-result-source", item.source || "Fonte"), node("small", "muted", item.duration ? "Duração: " + Math.floor(item.duration / 60) + ":" + String(Math.floor(item.duration % 60)).padStart(2, "0") : (item.downloadable ? "Arquivo aberto · confira a licença" : "Abra no editor para importar e editar automaticamente, quando disponível"))); content.appendChild(details);
    if (item.embedUrl) { try { const embed = new URL(item.embedUrl); if (embed.protocol === "https:" && embed.hostname === "www.youtube-nocookie.com" && /^\/embed\/[\w-]{11}$/.test(embed.pathname)) { const frame = document.createElement("iframe"); frame.className = "audio-result-embed"; frame.src = embed.href; frame.title = "Prévia: " + (item.title || "resultado de áudio"); frame.loading = "lazy"; frame.referrerPolicy = "strict-origin-when-cross-origin"; frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"; frame.allowFullscreen = true; content.appendChild(frame); } } catch {} }
    else if (item.downloadable === true && ["upload.wikimedia.org","archive.org"].includes(host)) { const player = node("audio", "media-audio-player"); player.controls = true; player.preload = "none"; player.src = url.href; player.setAttribute("aria-label", "Reproduzir " + (item.title || "áudio")); content.appendChild(player); }
    const actions = node("div", "audio-result-actions");
    const download = node("button", "media-result-download", "✂ Editar e baixar");
    download.type = "button";
    download.addEventListener("click", () => baixarResultadoAudio(item, download));
    download.title = item.downloadable === true ? "Abrir o editor com este áudio" : "Abrir o editor; esta plataforma pode exigir importação manual do arquivo";
    actions.appendChild(download);
    const send = node("button", "audio-action-button audio-action-send", "↗ WhatsApp"); send.type = "button"; send.addEventListener("click", () => enviarResultadoAudioWhatsapp(item, send)); actions.appendChild(send);
    const sourceLink = node("a", "audio-source-link", item.embedUrl ? "Prévia / fonte ↗" : "Abrir fonte ↗"); sourceLink.href = url.href; sourceLink.target = "_blank"; sourceLink.rel = "noopener noreferrer"; actions.appendChild(sourceLink);
    content.appendChild(actions); card.append(media, content); area.appendChild(card); shown++;
  }
  if (!shown) area.appendChild(node("p", "muted", "Os resultados recebidos não tinham links seguros para exibir. Tente outra pesquisa."));
}
$("#audio-link-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const input=$("#audio-link-url"),button=$("#audio-link-submit"),raw=input?.value.trim();
  if(!raw)return setApiStatus("#audio-link-status","Cole um link HTTPS público.",true);
  let parsed;try{parsed=new URL(raw);}catch{return setApiStatus("#audio-link-status","Esse link não parece válido.",true);}
  if(parsed.protocol!=="https:"||parsed.username||parsed.password)return setApiStatus("#audio-link-status","Use um link HTTPS público, sem usuário ou senha no endereço.",true);
  button.disabled=true;const old=button.textContent;button.textContent="Preparando…";setApiStatus("#audio-link-status","Verificando o link e preparando o MP3. Isso pode levar alguns instantes.");
  try{
    const response=await fetch("/api/app/media/audio/import",{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json"},body:JSON.stringify({url:parsed.href}),cache:"no-store"});
    if(!response.ok){let data={};try{data=await response.json();}catch{}throw new Error(data.error||"Não foi possível baixar o áudio desse link.");}
    const blob=await response.blob();if(!blob.size||blob.size>12*1024*1024)throw new Error("O MP3 ficou vazio ou passou do limite de 12 MB.");
    const objectUrl=URL.createObjectURL(blob),a=document.createElement("a");a.href=objectUrl;a.download="nuvem-audio.mp3";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
    setApiStatus("#audio-link-status","MP3 preparado e download iniciado. Se não funcionar, confira os downloads do navegador.");
  }catch(error){setApiStatus("#audio-link-status",error.message||"Falha ao preparar o áudio.",true);}
  finally{button.disabled=!session;button.textContent=old;}
});
$("#audio-search-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const query = $("#audio-search-query").value.trim();
  const button = $("#audio-search-submit");
  if (!query) return setApiStatus("#audio-search-status", "Digite o que deseja encontrar.", true);
  button.disabled = true;
  setApiStatus("#audio-search-status", "Buscando no YouTube, SoundCloud e arquivos de áudio abertos. Isso pode levar alguns segundos…");
  $("#audio-search-results")?.replaceChildren();
  try {
    const result = await api("/api/app/media/search-audio", { method: "POST", body: JSON.stringify({ query }) });
    desenharResultadosAudio(result.results || []);
    setApiStatus("#audio-search-status", result.notice || (result.results?.length ? "Pesquisa concluída." : "Nenhum resultado encontrado."));
  } catch (error) {
    setApiStatus("#audio-search-status", error.message, true);
  } finally { button.disabled = !session; }
});
document.querySelectorAll("[data-audio-query]").forEach(button => button.addEventListener("click", () => {
  const input = $("#audio-search-query");
  if (!input || !session) return;
  input.value = button.dataset.audioQuery || "";
  $("#audio-search-form")?.requestSubmit();
}));
$("#audio-editor-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const file = $("#audio-editor-file")?.files?.[0];
  const start = Number($("#audio-trim-start")?.value);
  const end = Number($("#audio-trim-end")?.value);
  const button = $("#audio-trim-submit");
  if (!file) return setApiStatus("#audio-editor-status", "Escolha um arquivo de áudio ou vídeo.", true);
  if (!["audio","video"].includes(identificarTipoArquivo(file))) return setApiStatus("#audio-editor-status", "Formato não reconhecido. Escolha um arquivo de áudio ou vídeo comum.", true);
  if (file.size > 12*1024*1024) return setApiStatus("#audio-editor-status", "O limite do arquivo é 12 MB.", true);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 600 || end-start > 180) return setApiStatus("#audio-editor-status", "O início e o fim devem ser válidos. O corte pode ter até 3 minutos.", true);
  button.disabled = true;
  setApiStatus("#audio-editor-status", "Cortando o trecho e convertendo para MP3…");
  try {
    const response = await fetch("/api/app/media/audio/trim?start="+encodeURIComponent(start)+"&end="+encodeURIComponent(end), {
      method:"POST", headers:{Authorization:"Bearer "+session.access_token,"Content-Type":file.type||"application/octet-stream"}, body:file, cache:"no-store"
    });
    if (!response.ok) { let body={}; try { body=await response.json(); } catch {} throw new Error(body.error || "Não foi possível cortar o áudio (erro "+response.status+")."); }
    audioEditBlob = await response.blob();
    if (!audioEditBlob.size) throw new Error("O áudio cortado ficou vazio.");
    if (audioEditObjectUrl) URL.revokeObjectURL(audioEditObjectUrl);
    audioEditObjectUrl = URL.createObjectURL(audioEditBlob);
    $("#audio-editor-player").src = audioEditObjectUrl;
    $("#audio-editor-download").href = audioEditObjectUrl;
    $("#audio-editor-preview").hidden = false;
    $("#audio-send-whatsapp").disabled = !session;
    setApiStatus("#audio-editor-status", "Trecho pronto! Ouça, baixe o MP3 ou envie para o WhatsApp conectado.");
  } catch(error) {
    setApiStatus("#audio-editor-status", error.message || "Falha ao cortar o áudio.", true);
  } finally { button.disabled = !session; }
});
$("#audio-send-whatsapp")?.addEventListener("click", async () => {
  if (!session?.access_token || !audioEditBlob) return setApiStatus("#audio-editor-status", "Corte um áudio antes de enviar.", true);
  const button=$("#audio-send-whatsapp");
  button.disabled=true;
  setApiStatus("#audio-editor-status","Enviando áudio para o WhatsApp conectado…");
  try {
    const response=await fetch("/api/app/media/audio/send",{method:"POST",headers:{Authorization:"Bearer "+session.access_token,"Content-Type":"audio/mpeg"},body:audioEditBlob,cache:"no-store"});
    let body={}; try { body=await response.json(); } catch {}
    if(!response.ok) throw new Error(body.error || "Não foi possível enviar o áudio.");
    setApiStatus("#audio-editor-status",body.message || "Áudio enviado ao WhatsApp.");
  } catch(error) { setApiStatus("#audio-editor-status",error.message || "Falha no envio.",true); }
  finally { button.disabled=!session || !audioEditBlob; }
});

function localDateHoje(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
$("#expense-period")?.addEventListener("change",()=>drawExpenses(allExpenses));
$("#expense-search")?.addEventListener("input",()=>drawExpenses(allExpenses));
$("#expense-export")?.addEventListener("click",()=>{
  if(!session)return setApiStatus("#expense-status","Entre para exportar seus dados.",true);
  if(!filteredExpenses.length)return setApiStatus("#expense-status","Não há lançamentos para exportar neste filtro.",true);
  const quote=value=>'"'+String(value??"").replace(/"/g,'""')+'"';
  const csv=["Data,Descrição,Categoria,Valor (BRL)",...filteredExpenses.map(e=>[e.spent_at,e.description,e.category,Number(e.amount).toFixed(2)].map(quote).join(","))].join("\r\n");
  const url=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}));
  const link=node("a","","Exportar CSV");link.href=url;link.download="nuvem-financas.csv";link.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
});
if($("#expense-date"))$("#expense-date").value=localDateHoje();
