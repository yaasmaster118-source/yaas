(() => {
 let installEvent=null,registration=null,reloading=false,updateRequested=false;
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 function sync(){document.querySelectorAll('[data-install-app]').forEach(button=>{button.hidden=standalone();});}
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;sync();});
 window.addEventListener('appinstalled',()=>{installEvent=null;sync();document.querySelector('#pwa-install-dialog')?.close();});
 function openInstall(){
  if(standalone())return;
  const dialog=document.querySelector('#pwa-install-dialog');
  document.querySelector('#pwa-install-title').textContent='YAAS’ı nereye yükleyelim?';
  document.querySelector('#pwa-device-choices').hidden=false;
  document.querySelector('#pwa-device-details').hidden=true;
  if(!dialog.open)dialog.showModal();
 }
 function selectDevice(device){
  const phone=device==='phone';
  const ua=navigator.userAgent;
  const apple=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const currentPhone=apple||/Android/.test(ua);
  document.querySelector('#pwa-install-title').textContent=phone?'Telefonuna YAAS yükle':'PC’ye YAAS yükle';
  document.querySelector('#pwa-device-choices').hidden=true;
  document.querySelector('#pwa-device-details').hidden=false;
  document.querySelector('#pwa-install-help').textContent=phone?'Android: YAAS’ı Chrome’da aç. ⋮ menüsünden “Uygulamayı yükle” veya “Ana ekrana ekle”yi seç. iPhone/iPad: Safari’de Paylaş → Ana Ekrana Ekle → Ekle.':'Bilgisayarında YAAS’ı Chrome veya Edge’de aç. Adres çubuğundaki yükleme simgesini ya da tarayıcı menüsündeki “Uygulamayı yükle / Bu siteyi uygulama olarak yükle” seçeneğini kullan. Mac Safari’de destekleniyorsa “Dock’a Ekle”yi seç.';
  const action=document.querySelector('#pwa-install-now');
  action.hidden=!installEvent||currentPhone!==phone;
  action.textContent=phone?'Bu telefona yükle':'Bu PC’ye yükle';
  document.querySelector('#pwa-device-note').textContent=currentPhone!==phone?(phone?'Telefonunda aynı YAAS bağlantısını açarak yükleyebilirsin.':'PC’nde aynı YAAS bağlantısını açarak yükleyebilirsin.'):'Kurulum seçeneği tarayıcında görünüyorsa yukarıdaki adımlarla devam edebilirsin.';
 }
 async function installNow(){
  if(!installEvent)return;
  const event=installEvent;installEvent=null;
  document.querySelector('#pwa-install-now').hidden=true;
  try{await event.prompt();const choice=await event.userChoice;document.querySelector('#pwa-device-note').textContent=choice.outcome==='accepted'?'Kurulum onaylandı. YAAS simgesinden açabilirsin.':'Kurulum iptal edildi. İstersen daha sonra yeniden deneyebilirsin.';}catch{document.querySelector('#pwa-device-note').textContent='Kurulum penceresi açılamadı. Yukarıdaki tarayıcı menüsü adımlarını kullan.';}
 }
 function showUpdate(){
  let banner=document.querySelector('#pwa-update');if(banner)return;
  banner=document.createElement('aside');banner.id='pwa-update';banner.className='pwa-update';banner.setAttribute('aria-label','Uygulama güncellemesi');
  banner.innerHTML='<span>YAAS’ın yeni sürümü hazır. Gönderilmemiş yazını koruyup görüşmeni bitirdikten sonra yenile.</span><button type="button" data-pwa-update>Şimdi yenile</button><button type="button" data-pwa-later>Daha sonra</button>';
  banner.querySelector('[data-pwa-later]').onclick=()=>banner.remove();banner.querySelector('[data-pwa-update]').onclick=()=>{if(registration?.waiting){updateRequested=true;registration.waiting.postMessage({type:'APPLY_UPDATE'});}else location.reload();};document.body.append(banner);
 }
 function init(){
  const dialog=document.createElement('dialog');dialog.id='pwa-install-dialog';dialog.setAttribute('aria-labelledby','pwa-install-title');dialog.innerHTML='<button type="button" class="pwa-close" aria-label="Kurulum bilgisini kapat">×</button><img src="/assets/app-icon-192.png" width="64" height="64" alt=""><h2 id="pwa-install-title">YAAS’ı nereye yükleyelim?</h2><div id="pwa-device-choices" class="pwa-device-choices"><button type="button" data-install-device="phone"><span aria-hidden="true">▯</span>Telefon</button><button type="button" data-install-device="pc"><span aria-hidden="true">▰</span>PC</button></div><div id="pwa-device-details" hidden><p id="pwa-install-help"></p><p id="pwa-device-note" role="status"></p><button type="button" id="pwa-install-now" hidden>Yükle</button><button type="button" id="pwa-device-back">← Cihaz seçimine dön</button></div><small>Kurulum ücretsiz. Mesajlaşma ve yayınlar için internet gerekir.</small>';dialog.querySelector('.pwa-close').onclick=()=>dialog.close();dialog.querySelectorAll('[data-install-device]').forEach(button=>button.onclick=()=>selectDevice(button.dataset.installDevice));dialog.querySelector('#pwa-device-back').onclick=openInstall;dialog.querySelector('#pwa-install-now').onclick=installNow;document.body.append(dialog);
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
