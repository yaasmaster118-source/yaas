"use strict";
function accountDialog(title,markup,onSubmit){
  document.querySelector('#account-dialog')?.remove();
  const previous=document.activeElement,layer=document.createElement('div');layer.className='modal-layer';layer.id='account-dialog';
  layer.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><header class="modal-header"><h2 id="account-dialog-title">${escapeHtml(title)}</h2><button type="button" class="icon-button" data-close aria-label="Kapat">×</button></header><form>${markup}<p class="form-error" role="status"></p><footer><button type="button" class="secondary" data-close>Vazgeç</button><button class="primary" type="submit">Devam et</button></footer></form></section>`;
  document.body.append(layer);const close=()=>{layer.remove();previous?.focus();};
  layer.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);
  layer.onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const controls=[...layer.querySelectorAll('button:not(:disabled),input,textarea')];if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0].focus();}}};
  layer.querySelector('input,textarea,button').focus();
  layer.querySelector('form').onsubmit=async e=>{e.preventDefault();const submit=layer.querySelector('[type=submit]'),status=layer.querySelector('[role=status]');submit.disabled=true;status.textContent='';try{const message=await onSubmit(new FormData(e.currentTarget));close();notify(message||'İşlem tamamlandı');}catch(error){status.textContent=error.message;submit.disabled=false;}};
}
function requestPasswordReset(){accountDialog('Şifremi unuttum','<label>E-posta<input name="email" type="email" autocomplete="email" required></label>',async form=>(await api('/api/auth/reset-request',{method:'POST',body:JSON.stringify({email:form.get('email')})})).message);}
async function mountAccountSecurity(){
  const panel=document.querySelector('#account-security-panel');if(!panel)return;
  try{const data=await api('/api/account/security');if(!panel.isConnected)return;
    panel.innerHTML=`<h3>Hesap güvenliği</h3><p>${data.emailVerified?'E-posta doğrulandı.':'E-posta henüz doğrulanmadı.'}</p>${!data.emailReady?'<p>E-posta gönderimi için hizmet kurulumu bekleniyor.</p>':''}<button class="secondary" id="account-verify" ${!data.emailReady||data.emailVerified?'disabled':''}>Doğrulama e-postası gönder</button><h3>Engellediğin kişiler</h3>${data.blocks.map(p=>`<article class="settings-info-row"><span>${escapeHtml(p.display_name)} · @${escapeHtml(p.handle)}</span><button class="secondary" data-unblock="${p.id}">Engeli kaldır</button></article>`).join('')||'<p>Engellediğin kişi yok.</p>'}`;
    panel.querySelector('#account-verify').onclick=async()=>{try{await api('/api/account/verify-request',{method:'POST',body:'{}'});notify('Doğrulama bağlantısı gönderildi');}catch(e){notify(e.message,true);}};
    panel.querySelectorAll('[data-unblock]').forEach(b=>b.onclick=async()=>{try{await api(`/api/blocks/${b.dataset.unblock}`,{method:'DELETE'});await mountAccountSecurity();notify('Engel kaldırıldı');}catch(e){notify(e.message,true);}});
  }catch(e){panel.textContent=e.message;}
}
function openBlockDialog(person){accountDialog('Kullanıcıyı engelle',`<p>${escapeHtml(person.display_name||person.handle)} ile DM ve arkadaşlık istekleri iki yönde durdurulacak. Mesaj geçmişi korunur. Ayarlar → Hesabım bölümünden engeli kaldırabilirsin.</p>`,async()=>{await api(`/api/blocks/${person.id}`,{method:'POST',body:'{}'});return 'Kullanıcı engellendi';});}
function openReportDialog(person){accountDialog('Kullanıcıyı bildir','<label>Açıklama<textarea name="reason" required minlength="5" maxlength="1000" placeholder="Sorunu açıklayın"></textarea></label>',async form=>{await api('/api/reports',{method:'POST',body:JSON.stringify({targetId:person.id,reason:form.get('reason')})});return 'Bildirimin YAAS sahibine iletildi';});}
async function mountUserReports(){
  const panel=document.querySelector('#user-reports-panel');if(!panel)return;
  try{const data=await api('/api/admin/reports');if(!panel.isConnected)return;panel.innerHTML='<h3>Kullanıcı bildirimleri</h3>'+ (data.reports.map(r=>`<article class="settings-info-row"><span><strong>@${escapeHtml(r.target_handle)}</strong><small>${escapeHtml(r.reason)}</small></span><button class="secondary" data-report="${r.id}" data-status="${r.status==='open'?'closed':'open'}">${r.status==='open'?'İnceleme tamamlandı':'Yeniden aç'}</button></article>`).join('')||'<p>Bildirim yok.</p>');panel.querySelectorAll('[data-report]').forEach(b=>b.onclick=async()=>{try{await api(`/api/admin/reports/${b.dataset.report}`,{method:'PATCH',body:JSON.stringify({status:b.dataset.status})});await mountUserReports();}catch(e){notify(e.message,true);}});}catch(e){panel.textContent=e.message;}
}
document.querySelector('#forgot-password-button').onclick=requestPasswordReset;
const accountLink=new URLSearchParams(location.hash.slice(1));
if(['reset','verify'].includes(accountLink.get('account'))){
  const purpose=accountLink.get('account'),token=accountLink.get('token');history.replaceState(null,'',location.pathname+location.search);
  accountDialog(purpose==='reset'?'Yeni şifre belirle':'E-postanı doğrula',purpose==='reset'?'<label>Yeni şifre<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="1024"></label><label>Şifre tekrar<input name="confirmation" type="password" autocomplete="new-password" required minlength="8"></label>':'<p>E-posta adresini doğrulamak için devam et.</p>',async form=>{if(purpose==='reset'&&form.get('password')!==form.get('confirmation'))throw new Error('Şifreler aynı olmalı.');await api(`/api/auth/${purpose}-complete`,{method:'POST',body:JSON.stringify({token,password:form.get('password')})});return purpose==='reset'?'Şifre yenilendi. Yeni şifrenle giriş yap.':'E-posta doğrulandı';});
}
