'use strict';
const OFFLINE_CACHE='yaas-offline-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(OFFLINE_CACHE).then(cache=>cache.addAll(['/offline.html','/offline.js','/pwa.css','/assets/app-icon-192.png'])));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('yaas-offline-')&&key!==OFFLINE_CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data?.type==='APPLY_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // Private API data, uploads, streams and authenticated pages never enter this cache.
 if(url.origin!==self.location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/'))return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).catch(async()=>{const cached=await caches.match('/offline.html');return cached||new Response('YAAS: İnternet bağlantısı gerekli.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}));
  return;
 }
 if(['/offline.js','/pwa.css','/assets/app-icon-192.png'].includes(url.pathname))event.respondWith(fetch(event.request).catch(()=>caches.match(url.pathname)));
});

