const labels={inicio:"Início",ia:"JARVIS",figurinhas:"Estúdio de figurinhas",midia:"Central de mídia",financas:"Finanças",lembretes:"Lembretes",historico:"Histórico",config:"Configurações"};
let supabaseClient=null, session=null, busy=false, vapidPublicKey='';
const $=selector=>document.querySelector(selector);
function abrirVista(nome){if(!labels[nome])return;document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active",el.id==="view-"+nome));document.querySelectorAll("[data-view]").forEach(el=>el.classList.toggle("active",el.dataset.view===nome));const crumb=$("#crumb");if(crumb)crumb.textContent=labels[nome];window.scrollTo({top:0,behavior:"smooth"});}
document.querySelectorAll("[data-view]").forEach(el=>el.addEventListener("click",()=>abrirVista(el.dataset.view)));
function setLoginStatus(message,isError=false){const el=$("#login-status");if(el){el.textContent=message;el.classList.toggle("error-text",isError);}}
function setApiStatus(selector,message,isError=false){const el=$(selector);if(el){el.textContent=message;el.classList.toggle("error-text",isError);}}
async function api(path,options={}){if(!session?.access_token)throw new Error("Entre na sua conta novamente.");const response=await fetch(path,{...options,headers:{"Content-Type":"application/json","Authorization":"Bearer "+session.access_token,...(options.headers||{})}});let body={};try{body=await response.json()}catch{}if(!response.ok)throw new Error(body.error||"Não foi possível concluir a operação.");return body;}
function formatBRL(value){return Number(value||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function addChatMessage(role,content){const area=$("#chat-messages");if(!area)return;const bubble=node("div","chat-message "+(role==="user"?"user-message":"assistant-message"),content);area.appendChild(bubble);area.scrollTop=area.scrollHeight;}
async function loadChat(){const area=$("#chat-messages");if(!area)return;area.replaceChildren();try{const data=await api("/api/app/chat?limit=40");if(!data.messages.length)addChatMessage("assistant","Olá! Sou a Nuvem. Como posso ajudar?");for(const m of data.messages)addChatMessage(m.role,m.content);}catch(e){addChatMessage("assistant",e.message);}}
let historyMessages=[];
function drawHistory(){const list=$("#history-list");if(!list)return;const term=($("#history-search")?.value||"").trim().toLowerCase();const filtered=historyMessages.filter(m=>!term||m.content.toLowerCase().includes(term));list.replaceChildren();if(!filtered.length){list.appendChild(node("p","muted",term?"Nenhum resultado para essa busca.":"Seu histórico ainda está vazio."));return;}for(const m of filtered.slice().reverse()){const item=node("article","history-item"),top=node("div","history-item-top"),role=node("strong","",m.role==="user"?"Você":"Nuvem"),date=node("small","",new Date(m.created_at).toLocaleString("pt-BR")),content=node("p","",m.content);top.append(role,date);item.append(top,content);list.appendChild(item);}}
async function loadHistory(){const data=await api("/api/app/chat?limit=100");historyMessages=data.messages||[];drawHistory();}
$("#history-search")?.addEventListener("input",drawHistory);
async function sendChat(event){event.preventDefault();if(busy||!session)return;const input=$("#chat-input"),button=$("#chat-send"),text=input.value.trim();if(!text)return;if(text.length>4000){setApiStatus("#chat-status","Limite de 4000 caracteres por mensagem.",true);return;}busy=true;button.disabled=true;input.disabled=true;addChatMessage("user",text);input.value="";setApiStatus("#chat-status","A IA está pensando…");try{const result=await api("/api/app/chat",{method:"POST",body:JSON.stringify({content:text})});addChatMessage("assistant",result.message.content);setApiStatus("#chat-status","Mensagem salva no seu histórico.");await loadHistory();}catch(e){setApiStatus("#chat-status",e.message,true);addChatMessage("assistant","Não consegui concluir essa mensagem. "+e.message);}finally{busy=false;button.disabled=false;input.disabled=false;input.focus();}}
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
async function loadExpenses(){const data=await api("/api/app/expenses");drawExpenses(data.expenses);}
async function addExpense(event){event.preventDefault();if(!session)return;const description=$("#expense-description").value.trim(),amount=Number($("#expense-amount").value);const button=$("#expense-submit");button.disabled=true;setApiStatus("#expense-status","Salvando…");try{await api("/api/app/expenses",{method:"POST",body:JSON.stringify({description,amount,spent_at:$("#expense-date")?.value||new Date().toISOString().slice(0,10),category:$("#expense-category-input")?.value||"Outros"})});$("#expense-form").reset();if($("#expense-date"))$("#expense-date").value=localDateHoje();await loadExpenses();setApiStatus("#expense-status","Despesa salva com segurança.");}catch(e){setApiStatus("#expense-status",e.message,true);}finally{button.disabled=false;}}
function setAuthenticatedUI(user){const logged=Boolean(user);$("#login-screen").hidden=logged;$("#logout-button").hidden=!logged;$("#chat-input").disabled=!logged;$("#chat-send").disabled=!logged;$("#expense-description").disabled=!logged;$("#expense-amount").disabled=!logged;const expenseDate=$("#expense-date");if(expenseDate)expenseDate.disabled=!logged;const cat=$("#expense-category-input");if(cat)cat.disabled=!logged;$("#expense-submit").disabled=!logged;["#reminder-title","#reminder-note","#reminder-time","#reminder-repeat","#reminder-date","#reminder-submit","#notification-enable","#sticker-editor-file","#sticker-caption","#sticker-caption-color","#sticker-outline-color","#sticker-caption-size","#sticker-remove-bg","#sticker-add-pack","#sticker-send-current","#sticker-pack-name","#sticker-create-pack","#sticker-pack-select","#sticker-send-pack","#sticker-delete-pack","#sticker-video-file","#sticker-video-submit","#audio-file","#audio-submit","#audio-search-query","#audio-search-submit"].forEach(s=>{const el=$(s);if(el)el.disabled=!logged;});["#profile-name","#profile-assistant","#profile-language","#profile-style","#profile-save"].forEach(s=>{const el=$(s);if(el)el.disabled=!logged;});const label=$("#connection-label");if(label)label.textContent=logged?"Conta autenticada":"API ainda não conectada";setStickerEditorControls();}
async function loadProfile(){const data=await api("/api/app/me");const p=data.profile||{};$("#profile-name").value=p.display_name||"";$("#profile-assistant").value=p.assistant_name||"Nuvem";$("#profile-language").value=p.language||"pt-BR";$("#profile-style").value=p.response_style||"balanced";["#profile-name","#profile-assistant","#profile-language","#profile-style","#profile-save"].forEach(s=>$(s).disabled=false);setApiStatus("#profile-status","Preferências carregadas.");}
async function saveProfile(event){event.preventDefault();if(!session)return;const button=$("#profile-save");button.disabled=true;setApiStatus("#profile-status","Salvando preferências…");try{await api("/api/app/me",{method:"PUT",body:JSON.stringify({display_name:$("#profile-name").value,assistant_name:$("#profile-assistant").value,language:$("#profile-language").value,response_style:$("#profile-style").value})});setApiStatus("#profile-status","Preferências salvas.");}catch(e){setApiStatus("#profile-status",e.message,true);}finally{button.disabled=false;}}
$("#profile-form").addEventListener("submit",saveProfile);
async function afterLogin(user){session=(await supabaseClient.auth.getSession()).data.session;setAuthenticatedUI(user);if(!session)return;try{await Promise.all([loadProfile(),loadChat(),loadExpenses(),loadHistory(),loadReminders()]);setLoginStatus("Sessão validada.");}catch(e){setAuthenticatedUI(null);setLoginStatus(e.message,true);await supabaseClient.auth.signOut();}}
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
  ["#sticker-editor-file","#sticker-caption","#sticker-caption-color","#sticker-outline-color","#sticker-caption-size","#sticker-remove-bg","#sticker-undo-bg","#sticker-create-pack","#sticker-pack-name","#sticker-pack-select","#sticker-video-file","#sticker-video-submit"].forEach(selector => {
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
function removeUniformBackground(canvas, tolerance = 48) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const width = canvas.width, height = canvas.height;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data, count = width * height;
  let red = 0, green = 0, blue = 0, samples = 0;
  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 16) return;
    red += data[i]; green += data[i + 1]; blue += data[i + 2]; samples++;
  };
  for (let x = 0; x < width; x += 8) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y += 8) { sample(0, y); sample(width - 1, y); }
  if (!samples) return false;
  red /= samples; green /= samples; blue /= samples;
  const queue = new Int32Array(count);
  const visited = new Uint8Array(count);
  let head = 0, tail = 0;
  const enqueue = index => { if (!visited[index]) { visited[index] = 1; queue[tail++] = index; } };
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const pixel = queue[head++], i = pixel * 4;
    if (data[i + 3] < 16) continue;
    const dr = data[i] - red, dg = data[i + 1] - green, db = data[i + 2] - blue;
    if (Math.sqrt(dr * dr + dg * dg + db * db) > tolerance) continue;
    data[i + 3] = 0;
    const x = pixel % width, y = (pixel / width) | 0;
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }
  context.putImageData(image, 0, 0);
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
$("#sticker-remove-bg")?.addEventListener("click", () => {
  if (!stickerOriginalCanvas) return;
  try {
    const edited = document.createElement("canvas");
    edited.width = edited.height = 512;
    edited.getContext("2d").drawImage(stickerOriginalCanvas, 0, 0);
    if (!removeUniformBackground(edited, 48)) throw new Error("Não encontrei pixels de fundo para remover.");
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
  const file = $("#sticker-video-file")?.files?.[0];
  if (!file) return setApiStatus("#sticker-video-status", "Escolha um vídeo primeiro.", true);
  if (identificarTipoArquivo(file) !== "video") return setApiStatus("#sticker-video-status", "Escolha um arquivo de vídeo compatível.", true);
  await enviarArquivoParaDownload("/api/app/media/sticker-video", file, "#sticker-video-status", $("#sticker-video-submit"), "nuvem-figurinha-animada.webp", true);
});

$("#audio-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const file = $("#audio-file")?.files?.[0];
  if (!file) return setApiStatus("#audio-status", "Escolha um vídeo ou áudio.", true);
  if (!["video", "audio"].includes(identificarTipoArquivo(file))) return setApiStatus("#audio-status", "Formato não reconhecido. Escolha MP3, WAV, M4A, MP4, MOV ou WEBM.", true);
  await enviarArquivoParaDownload("/api/app/media/audio", file, "#audio-status", $("#audio-submit"), "nuvem-audio.mp3");
});
function desenharResultadosAudio(results) {
  const area = $("#audio-search-results");
  if (!area) return;
  area.replaceChildren();
  if (!results.length) {
    area.appendChild(node("p", "muted", "Nenhum áudio com licença aberta foi encontrado. Tente outro termo ou pesquise em inglês."));
    return;
  }
  for (const item of results) {
    let url;
    try { url = new URL(item.url); } catch { continue; }
    if (url.protocol !== "https:" || !(url.hostname === "upload.wikimedia.org" || url.hostname === "archive.org")) continue;
    const card = node("article", "media-result");
    const details = node("div", "media-result-details");
    details.append(node("strong", "", item.title || "Áudio sem título"), node("small", "", item.source || "Fonte aberta"));
    const player = node("audio", "media-audio-player");
    player.controls = true;
    player.preload = "none";
    player.src = url.href;
    player.setAttribute("aria-label", "Reproduzir " + (item.title || "áudio"));
    player.addEventListener("error", () => {
      const note = node("small", "muted", "Este arquivo não pôde ser reproduzido aqui. Use o link para abrir a fonte.");
      if (!card.contains(note)) card.appendChild(note);
    }, { once: true });
    const link = node("a", "media-result-link", "Abrir ou salvar áudio ↗");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Abrir " + (item.title || "áudio") + " em nova aba");
    card.append(details, player, link);
    area.appendChild(card);
  }
}
$("#audio-search-form")?.addEventListener("submit", async event => {
  event.preventDefault();
  const query = $("#audio-search-query").value.trim();
  const button = $("#audio-search-submit");
  if (!query) return setApiStatus("#audio-search-status", "Digite o que deseja encontrar.", true);
  button.disabled = true;
  setApiStatus("#audio-search-status", "Pesquisando fontes abertas…");
  $("#audio-search-results")?.replaceChildren();
  try {
    const result = await api("/api/app/media/search-audio", { method: "POST", body: JSON.stringify({ query }) });
    desenharResultadosAudio(result.results || []);
    setApiStatus("#audio-search-status", result.results?.length ? result.notice || "Pesquisa concluída." : "Pesquisa concluída sem resultados.");
  } catch (error) {
    setApiStatus("#audio-search-status", error.message, true);
  } finally {
    button.disabled = !session;
  }
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
