'use strict';
const retry=document.querySelector('#retry');
retry.addEventListener('click',()=>{retry.disabled=true;document.querySelector('#retry-status').textContent='Bağlantı kontrol ediliyor…';location.reload();});
window.addEventListener('online',()=>location.reload());
