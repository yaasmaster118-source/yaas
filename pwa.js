(() => {
 let installEvent=null,registration=null,reloading=false,updateRequested=false;
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 function sync(){document.querySelectorAll('[data-install-app]').forEach(button=>{button.hidden=standalone();});}
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;sync();});
 window.addEventListener('appinstalled',()=>{installEvent=null;sync();document.querySelector('#pwa-install-dialog')?.close();});
 async function openInstall(){
  if(standalone())return;
  if(installEvent){const event=installEvent;installEvent=null;try{await event.prompt();await event.userChoice;}catch{showHelp();}return;}
  showHelp();
 }
 function showHelp(){
  const dialog=document.querySelector('#pwa-install-dialog');
  const ua=navigator.userAgent;
  const apple=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const android=/Android/.test(ua);
  document.querySelector('#pwa-install-help').textContent=apple?'iPhone veya iPad’de siteyi Safari’de aç. Paylaş menüsünden “Ana Ekrana Ekle”yi seç, ardından “Ekle”ye dokun.':android?'Siteyi Chrome’da aç. Tarayıcının ⋮ menüsünden “Uygulamayı yükle” veya “Ana ekrana ekle”yi seç.':'Chrome veya Edge’de adres çubuğundaki yükleme simgesini ya da tarayıcı menüsündeki “Uygulamayı yükle / Bu siteyi uygulama olarak yükle” seçeneğini kullan. Safari’de destekleniyorsa “Dock’a Ekle”yi seç.';
  if(!dialog.open)dialog.showModal();
 }
 function showUpdate(){
  let banner=document.querySelector('#pwa-update');if(banner)return;
  banner=document.createElement('aside');banner.id='pwa-update';banner.className='pwa-update';banner.setAttribute('aria-label','Uygulama güncellemesi');
  banner.innerHTML='<span>YAAS’ın yeni sürümü hazır. Gönderilmemiş yazını koruyup görüşmeni bitirdikten sonra yenile.</span><button type="button" data-pwa-update>Şimdi yenile</button><button type="button" data-pwa-later>Daha sonra</button>';
  banner.querySelector('[data-pwa-later]').onclick=()=>banner.remove();banner.querySelector('[data-pwa-update]').onclick=()=>{if(registration?.waiting){updateRequested=true;registration.waiting.postMessage({type:'APPLY_UPDATE'});}else location.reload();};document.body.append(banner);
 }
 function init(){
  const dialog=document.createElement('dialog');dialog.id='pwa-install-dialog';dialog.setAttribute('aria-labelledby','pwa-install-title');dialog.innerHTML='<button type="button" class="pwa-close" aria-label="Kurulum bilgisini kapat">×</button><img src="/assets/app-icon-192.png" width="64" height="64" alt=""><h2 id="pwa-install-title">YAAS hep yanında</h2><p>YAAS’ı ana ekranına ekle; kendi penceresinde aç.</p><p id="pwa-install-help"></p><small>Kurulum ücretsiz. Mesajlaşma ve yayınlar için internet gerekir. Bu tarayıcıda yükleme seçeneği yoksa Chrome, Edge veya Safari kullan.</small>';dialog.querySelector('button').onclick=()=>dialog.close();document.body.append(dialog);
  document.querySelectorAll('[data-install-app]').forEach(button=>button.addEventListener('click',openInstall));sync();
  const connection=document.createElement('div');connection.className='pwa-connection';connection.setAttribute('role','status');connection.hidden=navigator.onLine;connection.textContent='İnternet bağlantısı yok. Gönderim başarısız olursa mesajını yeniden dene.';document.body.append(connection);
  const network=()=>{connection.hidden=navigator.onLine;};window.addEventListener('online',network);window.addEventListener('offline',network);
  if('serviceWorker' in navigator&&window.isSecureContext){
   navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!updateRequested||reloading)return;reloading=true;location.reload();});
   navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(value=>{registration=value;if(value.waiting)showUpdate();value.addEventListener('updatefound',()=>{const worker=value.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate();});});}).catch(()=>{document.querySelector('#pwa-install-help').textContent='Uygulama kurulumu hazırlanamadı. Sayfayı yenileyip tekrar dene.';});
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
