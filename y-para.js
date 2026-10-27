'use strict';
const Y_GIFTS=[{id:'spark',name:'Yıldız',icon:'🌟',y:10},{id:'rose',name:'Altın gül',icon:'🌹',y:25},{id:'heart',name:'Işık kalbi',icon:'💛',y:50},{id:'crown',name:'YAAS tacı',icon:'👑',y:100},{id:'rocket',name:'Y roketi',icon:'🚀',y:250},{id:'galaxy',name:'Galaksi',icon:'🌌',y:500}];
const Y_PACKAGES=[{id:'small',y:100,price:'100 ₺'},{id:'medium',y:550,price:'550 ₺'},{id:'large',y:1200,price:'1.200 ₺'}];
const Y_LIMIT=100000000;
function newYDemo(){return{version:2,accounts:{viewer:{purchased:0,earned:0,pending:0},host:{purchased:0,earned:0,pending:0}},platform:0,history:[]};}
function validYDemo(s){return Boolean(s?.version===2&&Number.isSafeInteger(s.platform)&&s.platform>=0&&Array.isArray(s.history)&&s.history.length<=500&&s.history.every(e=>e&&typeof e.id==='string'&&typeof e.label==='string'&&['viewer','host'].includes(e.actor)&&Number.isSafeInteger(e.y)&&e.y>0&&Number.isFinite(Date.parse(e.at)))&&['viewer','host'].every(id=>s.accounts?.[id]&&['purchased','earned','pending'].every(k=>Number.isSafeInteger(s.accounts[id][k])&&s.accounts[id][k]>=0&&s.accounts[id][k]<=Y_LIMIT)));}
function yDemoOperation(state,actor,kind,itemId,quantity=1){
 if(!validYDemo(state)||!['viewer','host'].includes(actor))throw Error('Deneme hesabı geçersiz. Sıfırlayıp tekrar dene.');
 const next=JSON.parse(JSON.stringify(state)),wallet=next.accounts[actor];let entry;
 if(kind==='purchase'){
  const pack=Y_PACKAGES.find(p=>p.id===itemId);if(!pack)throw Error('Paket bulunamadı.');const units=pack.y*100;
  if(wallet.purchased+wallet.earned+wallet.pending+units>Y_LIMIT)throw Error('Deneme bakiye sınırına ulaştın.');
  wallet.purchased+=units;entry={kind,actor,y:units,label:'Deneme Y alımı · '+pack.price};
 }else if(kind==='gift'){
  const gift=Y_GIFTS.find(g=>g.id===itemId);if(!gift)throw Error('Hediye bulunamadı.');
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>99)throw Error('Adet 1 ile 99 arasında olmalı.');
  const total=gift.y*quantity*100;if(wallet.purchased+wallet.earned<total)throw Error('Y Paran yetersiz. Y Para al bölümünden deneme bakiyesi ekle.');
  const recipient=actor==='viewer'?'host':'viewer',fee=total*15/100,net=total-fee,receiver=next.accounts[recipient];
  if(receiver.purchased+receiver.earned+receiver.pending+net>Y_LIMIT)throw Error('Alıcının deneme bakiye sınırına ulaşıldı.');
  const purchased=Math.min(wallet.purchased,total);wallet.purchased-=purchased;wallet.earned-=total-purchased;receiver.earned+=net;next.platform+=fee;
  entry={kind,actor,recipient,y:total,fee,net,quantity,label:gift.name};
 }else if(kind==='withdraw'){
  const units=Number(itemId);if(!Number.isSafeInteger(units)||units<=0||units>wallet.earned)throw Error('Yalnızca kazanılan, kullanılabilir bakiyenden geçerli bir tutar seç.');
  wallet.earned-=units;wallet.pending+=units;entry={kind,actor,y:units,status:'pending',label:'Deneme çekim talebi'};
 }else if(kind==='cancel-withdraw'){
  const found=next.history.find(e=>e.id===itemId&&e.actor===actor&&e.kind==='withdraw'&&e.status==='pending');if(!found)throw Error('Bekleyen çekim talebi bulunamadı.');
  found.status='cancelled';wallet.pending-=found.y;wallet.earned+=found.y;entry={kind,actor,y:found.y,label:'Deneme çekim talebi iptal edildi'};
 }else throw Error('İşlem geçersiz.');
 if(next.history.length>=500)throw Error('Deneme işlem sınırına ulaştın. Önce geçmişi dışa aktar, ardından denemeyi sıfırla.');
 entry.id=crypto.randomUUID();entry.at=new Date().toISOString();next.history.unshift(entry);return next;
}
if(typeof module!=='undefined')module.exports={Y_GIFTS,Y_PACKAGES,newYDemo,yDemoOperation,validYDemo};
if(typeof document!=='undefined'){
 const $=s=>document.querySelector(s),key='yaas:y-preview:v2';let state=newYDemo(),actor='viewer',pending=null,timer,historyFilter='all';
 try{const saved=JSON.parse(sessionStorage.getItem(key));if(validYDemo(saved))state=saved;}catch{}
 const format=n=>(n/100).toLocaleString('tr-TR',{maximumFractionDigits:2}),name=id=>id==='viewer'?'İzleyici hesabı':'Yayıncı hesabı';
 function status(text){$('#status').textContent=text;}
 function persist(){try{sessionStorage.setItem(key,JSON.stringify(state));}catch{status('Tarayıcı kaydı yapılamadı; sekme yenilenince deneme sıfırlanabilir.');}}
 function showTab(value){document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===value)));for(const id of ['gifts','buy','history','payout'])$('#'+id).hidden=id!==value;}
 function apply(kind,id,quantity){state=yDemoOperation(state,actor,kind,id,quantity);persist();render();}
 function entries(){return state.history.filter(e=>(e.actor===actor||e.recipient===actor)&&(historyFilter==='all'||(historyFilter==='received'?e.recipient===actor:historyFilter==='sent'?e.kind==='gift'&&e.actor===actor:historyFilter==='purchase'?e.kind==='purchase':e.kind.includes('withdraw'))));}
 function render(){
  const w=state.accounts[actor],target=actor==='viewer'?'host':'viewer';
  $('#balance').textContent=format(w.purchased+w.earned);$('#purchased').textContent=format(w.purchased)+' Y';$('#earned').textContent=format(w.earned)+' Y';$('#reserved').textContent=format(w.pending)+' Y';$('#target-label').textContent='Alıcı: '+name(target);$('#received').textContent=format(state.accounts[target].earned)+' Y kullanılabilir kazanç';
  $('#cash-value').textContent=format(w.earned)+' ₺';$('#pending-value').textContent=format(w.pending)+' ₺';$('#withdraw-max').textContent='Kullanılabilir kazanılan bakiye: '+format(w.earned)+' Y';
  const list=$('#history-list');list.replaceChildren();const rows=entries();
  if(!rows.length){const p=document.createElement('p');p.textContent='Bu bölümde henüz işlem yok.';list.append(p);}
  for(const e of rows){const incoming=e.recipient===actor,row=document.createElement('article');row.className='history-row';const copy=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('small'),amount=document.createElement('b');title.textContent=e.kind==='gift'?(incoming?'Hediye alındı · ':'Hediye gönderildi · ')+e.label+' ×'+e.quantity:e.label;
   detail.textContent=new Date(e.at).toLocaleString('tr-TR')+' · #'+e.id.slice(0,8)+(e.kind==='gift'?' · Toplam '+format(e.y)+' Y / YAAS '+format(e.fee)+' Y / Yayıncı '+format(e.net)+' Y':e.kind==='withdraw'?' · '+(e.status==='pending'?'Bekliyor (deneme)':'İptal edildi'):'');
   amount.textContent=(incoming||['purchase','cancel-withdraw'].includes(e.kind)?'+':'−')+format(incoming?e.net:e.y)+' Y';copy.append(title,detail);row.append(copy,amount);list.append(row);}
  const requests=$('#payout-requests');requests.replaceChildren();const withdrawals=state.history.filter(e=>e.actor===actor&&e.kind==='withdraw');
  for(const e of withdrawals){const row=document.createElement('article');row.className='history-row';const text=document.createElement('span');text.textContent=format(e.y)+' ₺ · '+(e.status==='pending'?'Bekliyor — gerçek ödeme yapılmaz':'İptal edildi');row.append(text);if(e.status==='pending'){const b=document.createElement('button');b.textContent='Talebi iptal et';b.onclick=()=>{try{apply('cancel-withdraw',e.id);status('Talep iptal edildi, kazanılan Y bakiyene geri eklendi.');}catch(error){status(error.message);}};row.append(b);}requests.append(row);}
  if(!withdrawals.length)requests.textContent='Henüz çekim talebi yok.';
 }
 function openConfirm(kind,id){pending={kind,id,actor};$('#quantity-wrap').hidden=kind!=='gift';$('#quantity').value='1';$('#confirm-title').textContent=kind==='purchase'?'Y Para paketi':kind==='gift'?Y_GIFTS.find(g=>g.id===id).name:kind==='withdraw'?'Çekim talebi önizlemesi':'Denemeyi sıfırla';updateConfirm();$('#confirm').showModal();}
 function updateConfirm(){if(!pending)return;const w=state.accounts[pending.actor];$('#confirm-action').disabled=false;$('#topup').hidden=true;
  if(pending.kind==='gift'){const gift=Y_GIFTS.find(g=>g.id===pending.id),qty=Number($('#quantity').value),total=gift.y*qty*100;const valid=Number.isSafeInteger(qty)&&qty>=1&&qty<=99;
   $('#confirm-detail').textContent=valid?'Alıcı: '+name(pending.actor==='viewer'?'host':'viewer')+' · Toplam '+format(total)+' Y. YAAS payı %15: '+format(total*.15)+' Y. Yayıncı payı %85: '+format(total*.85)+' Y.': '1–99 arasında tam adet gir.';
   $('#confirm-action').textContent=valid?format(total)+' Y gönder':'Geçerli adet seç';$('#confirm-action').disabled=!valid||total>w.purchased+w.earned;$('#topup').hidden=!valid||total<=w.purchased+w.earned;
   if(valid&&total>w.purchased+w.earned)$('#confirm-detail').textContent+=' Bakiyen yetersiz; eksik '+format(total-w.purchased-w.earned)+' Y.';
  }else if(pending.kind==='purchase'){const pack=Y_PACKAGES.find(p=>p.id===pending.id);$('#confirm-detail').textContent=pack.price+' örnek fiyat · '+pack.y+' deneme Y eklenecek. Gerçek ödeme alınmaz.';$('#confirm-action').textContent='Deneme bakiyesi ekle';
  }else if(pending.kind==='withdraw'){$('#confirm-detail').textContent=format(pending.id)+' kazanılan Y, örnek 1 Y = 1 ₺ hesabıyla '+format(pending.id)+' ₺ tutarında bekleyen deneme talebine ayrılacak. Gerçek banka ödemesi yapılmaz.';$('#confirm-action').textContent='Deneme talebi oluştur';
  }else{$('#confirm-detail').textContent='Bu sekmedeki iki deneme hesabının bakiyeleri, çekim talepleri ve geçmişi sıfırlanacak. Gerçek hesapların etkilenmez.';$('#confirm-action').textContent='Denemeyi sıfırla';}}
 for(const gift of Y_GIFTS){const b=document.createElement('button');b.className='gift-card';b.dataset.search=gift.name.toLocaleLowerCase('tr-TR');b.innerHTML=`<span class="symbol">${gift.icon}</span><strong>${gift.name}</strong><small>${gift.y} Y</small>`;b.setAttribute('aria-label',gift.name+' · '+gift.y+' Y');b.onclick=()=>openConfirm('gift',gift.id);$('#gift-grid').append(b);}
 for(const pack of Y_PACKAGES){const b=document.createElement('button');b.className='package';b.innerHTML=`<strong>${pack.y.toLocaleString('tr-TR')} Y</strong><small>DENEME PAKETİ · ÖRNEK FİYAT</small><b>${pack.price}</b><small>Ödeme yapmadan dene →</small>`;b.onclick=()=>openConfirm('purchase',pack.id);$('#package-grid').append(b);}
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));$('#buy-shortcut').onclick=()=>{showTab('buy');$('#buy').scrollIntoView({block:'start'});};$('#gift-shortcut').onclick=()=>{showTab('gifts');$('#gifts').scrollIntoView({block:'start'});};
 $('#quantity').oninput=updateConfirm;$('#cancel').onclick=()=>$('#confirm').close();$('#confirm').addEventListener('close',()=>pending=null);
 $('#topup').onclick=()=>{$('#confirm').close();showTab('buy');$('#buy').scrollIntoView({block:'start'});};
 $('#confirm-action').onclick=()=>{const a=pending;if(!a)return;const quantity=Number($('#quantity').value);pending=null;$('#confirm').close();try{
   if(a.kind==='reset'){state=newYDemo();persist();render();status('Deneme sıfırlandı.');return;}
   apply(a.kind,a.id,quantity);status(a.kind==='purchase'?'Deneme Y eklendi; gerçek tahsilat yapılmadı.':a.kind==='withdraw'?'Deneme çekim talebin oluşturuldu. Gerçek ödeme yapılmaz.':'Hediye gönderildi. %85 yayıncı kazancı ve %15 YAAS payı geçmişe işlendi.');
   if(a.kind==='gift'){const gift=Y_GIFTS.find(g=>g.id===a.id),el=$('#gift-animation');el.replaceChildren();const icon=document.createElement('b'),label=document.createElement('strong');icon.textContent=gift.icon;label.textContent=gift.name+' ×'+quantity;el.append(icon,label);el.classList.remove('play');void el.offsetWidth;el.classList.add('play');clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('play'),2700);}
  }catch(error){status(error.message);}};
 $('#persona').onchange=e=>{actor=e.target.value;$('#withdraw-amount').value='';render();status(name(actor)+' görünümündesin. Gerçek hesap değildir.');};$('#reset').onclick=()=>openConfirm('reset');
 $('#gift-search').oninput=e=>{const search=e.target.value.toLocaleLowerCase('tr-TR');let count=0;document.querySelectorAll('.gift-card').forEach(b=>{b.hidden=!b.dataset.search.includes(search);if(!b.hidden)count++;});$('#gift-empty').hidden=count>0;};
 $('#history-filter').onchange=e=>{historyFilter=e.target.value;render();};
 $('#withdraw-form').onsubmit=e=>{e.preventDefault();const raw=$('#withdraw-amount').value;if(!/^\d+(\.\d{1,2})?$/.test(raw)){status('En fazla iki ondalıklı bir Y tutarı gir.');return;}const amount=Math.round(Number(raw)*100);if(amount<=0||amount>state.accounts[actor].earned){status('Tutar kazanılan, kullanılabilir bakiyeni aşamaz.');return;}openConfirm('withdraw',amount);};
 $('#withdraw-all').onclick=()=>{$('#withdraw-amount').value=(state.accounts[actor].earned/100).toFixed(2);};
 $('#history-export').onclick=()=>{const rows=[['İşlem','Tarih','Tür','Tutar Y','YAAS payı Y','Yayıncı Y'],...entries().map(e=>[e.id,e.at,e.kind,(e.y/100).toFixed(2),((e.fee||0)/100).toFixed(2),((e.net||0)/100).toFixed(2)])];const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='yaas-deneme-islemleri.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Seçili işlem geçmişi CSV olarak indirildi.');};
 render();showTab('gifts');
}
