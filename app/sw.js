const CACHE_NAME="nuvem-shell-v16";
const SHELL=["/app/","/app/index.html","/app/styles.css?v=19","/app/app.js?v=20","/app/manifest.webmanifest","/app/icon.svg"];
const SHELL_PATHS=new Set(SHELL.map(item=>new URL(item,self.location.origin).pathname));
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("nuvem-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||!SHELL_PATHS.has(url.pathname))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match("/app/index.html"))));
});
self.addEventListener("push",event=>{let data={};try{data=event.data?event.data.json():{};}catch{}const title=typeof data.title==="string"?data.title:"Lembrete da Nuvem";const options={body:typeof data.body==="string"?data.body:"Você tem um lembrete.",icon:"/app/icon.svg",badge:"/app/icon.svg",tag:typeof data.tag==="string"?data.tag:"nuvem-push",data:{url:typeof data.url==="string"?data.url:"/app/"},renotify:false};event.waitUntil(self.registration.showNotification(title,options));});
self.addEventListener("notificationclick",event=>{event.notification.close();const target=event.notification.data?.url||"/app/";event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{for(const client of list){if("focus"in client){client.navigate(target);return client.focus();}}return clients.openWindow(target);}));});
