"use strict";
function dmIcon(name){const paths={gallery:'M3 3h18v18H3z M4 17l6-6 4 4 3-3 4 5 M8 7h.01',camera:'M3 7h4l2-3h6l2 3h4v14H3z M16 13a4 4 0 1 1-8 0a4 4 0 0 1 8 0',mic:'M9 3h6v12H9z M5 11v2a7 7 0 0 0 14 0v-2 M12 20v3 M8 23h8',emoji:'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0 M8 9h.01 M16 9h.01 M8 14q4 5 8 0',send:'M3 3l18 9-18 9 4-9z M7 12h14',file:'M5 2h10l4 4v16H5z M14 2v6h5 M8 12h8 M8 16h8',plus:'M12 4v16 M4 12h16'};return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]||paths.file}"/></svg>`;}
if(typeof window!=='undefined')window.dmComposerMarkup=()=>`<form class="dm-rich-composer dm-reference-composer" id="dm-page-message-form">
 <div data-preview class="dm-pending-media" hidden></div>
 <div class="dm-compose-row"><div class="dm-add-wrap"><button type="button" data-add aria-label="Dosya ekleme menüsü" aria-expanded="false">${dmIcon('plus')}</button><div data-add-menu class="dm-add-menu" hidden><strong>Ekle</strong><button type="button" data-add-gallery>${dmIcon('gallery')} Fotoğraf veya video</button><button type="button" data-add-camera>${dmIcon('camera')} Kamera</button><button type="button" data-add-file>${dmIcon('file')} Dosya</button><button type="button" data-add-voice>${dmIcon('mic')} Ses kaydı</button><button type="button" data-add-close>İptal</button></div></div>
 <div class="dm-compose-input"><textarea id="dm-page-message-input" maxlength="4000" placeholder="Mesajını yaz…" aria-label="Mesajını yaz" rows="2"></textarea>
 <div class="dm-composer-tools"><button type="button" data-gallery aria-label="Galeri" title="Fotoğraf veya video">${dmIcon('gallery')}</button><button type="button" data-camera aria-label="Kamera" title="Fotoğraf veya video çek">${dmIcon('camera')}</button><button type="button" data-mic aria-label="Ses kaydı" title="Basılı tut: kaydet · Bırak: gönder · Sola sürükle: iptal">${dmIcon('mic')}</button><button type="button" data-gif aria-label="GIF seç">GIF</button><button type="button" data-emoji aria-label="Emoji seç">${dmIcon('emoji')}</button><button type="button" data-stop hidden>Kaydı bitir</button><button type="button" data-cancel hidden>İptal</button></div></div>
 <button class="primary" data-send>Gönder ${dmIcon('send')}</button></div>
 <div data-record-panel class="dm-record-panel" hidden><span class="dm-record-symbol">${dmIcon('mic')}</span><div data-record-bars class="dm-record-bars">${'<i></i>'.repeat(20)}</div><strong data-record-time>0:00</strong></div><div class="dm-compose-footer"><p data-status role="status" class="dm-composer-status">Fotoğraf, video, ses, GIF veya dosya ekle.</p><span class="dm-enter-hint">Enter gönder · Shift+Enter yeni satır</span></div>
 <input data-media-file type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/webm,video/mp4,audio/webm,audio/ogg,audio/mp4,audio/wav" hidden><input data-document-file type="file" accept=".pdf,.txt,.zip" hidden>
 <section data-picker class="dm-media-picker" hidden aria-label="Medya seçimi"><header><div><button type="button" data-picker-tab="gif">GIF’ler</button><button type="button" data-picker-tab="sticker">Çıkartmalar</button><button type="button" data-picker-tab="emoji">Emojiler</button></div><button type="button" data-picker-close aria-label="Seçiciyi kapat">×</button></header><input data-picker-search placeholder="Ara…" aria-label="Medya ara"><div data-picker-categories class="dm-picker-categories"></div><div data-picker-results class="dm-picker-results"></div></section>
 <div data-emojis hidden></div></form>`;
// A recorder owns its streams, including streams granted after cancellation.
class DmCapture {
  constructor(devices, Recorder) { this.devices=devices;this.Recorder=Recorder;this.version=0;this.streams=[]; }
  async acquire(constraints) {
    const version=this.version, stream=await this.devices.getUserMedia(constraints);
    if(version!==this.version){stream.getTracks().forEach(track=>track.stop());throw new Error("Kayıt iptal edildi");}
    this.streams.push(stream);return stream;
  }
  record(stream,kind,onComplete,onError,onTick) {
    if(!this.Recorder)throw new Error("Bu tarayıcı kayıt yapmayı desteklemiyor");
    const types=kind==='audio'?['audio/webm;codecs=opus','audio/mp4','audio/webm']:['video/webm;codecs=vp8,opus','video/mp4','video/webm'];
    const mime=types.find(type=>this.Recorder.isTypeSupported(type)), version=this.version;
    const recorder=new this.Recorder(stream,mime?{mimeType:mime}:undefined);this.recorder=recorder;
    const chunks=[];let bytes=0,seconds=0,failed=false;
    recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;if(bytes>8*1024*1024){failed=true;this.stop();}}};
    recorder.onerror=()=>{failed=true;this.stop();};
    recorder.onstop=()=>{
      if(version!==this.version)return;
      clearInterval(this.timer);this.release();
      if(failed)return onError(new Error("Kayıt tamamlanamadı veya 8 MB sınırını aştı"));
      const type=recorder.mimeType.split(';')[0];
      onComplete(new Blob(chunks,{type}));
    };
    recorder.start(250);onTick(0);
    this.timer=setInterval(()=>{onTick(++seconds);if(seconds>=(kind==='audio'?120:20))this.stop();},1000);
  }
  stop(){if(this.recorder?.state==='recording')this.recorder.stop();}
  release(){this.streams.splice(0).forEach(stream=>stream.getTracks().forEach(track=>track.stop()));}
  cancel(){this.version++;clearInterval(this.timer);this.stop();this.release();}
}
if(typeof module!=='undefined')module.exports={DmCapture};
if(typeof window!=='undefined')window.mountDmComposer=function(form,{send,draft,onDraft,devices=navigator.mediaDevices,Recorder=window.MediaRecorder}){
  const input=form.querySelector('textarea'), status=form.querySelector('[data-status]'), preview=form.querySelector('[data-preview]');
  const sendButton=form.querySelector('[data-send]'), capture=new DmCapture(devices,Recorder);
  let file=null,objectUrl=null,dialog=null,busy=false,disposed=false,recording=false,hold=null,autoVoice=false,meterContext=null,meterTimer=null;
  input.value=draft||'';
  const message=value=>{status.textContent=value;};
  const disposePreview=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;file=null;preview.replaceChildren();preview.hidden=true;};
  const setFile=value=>{
    if(disposed)return false;
    const allowed=['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/mp4','audio/ogg','audio/wav','video/webm','video/mp4','application/pdf','application/zip','text/plain'];
    if(!allowed.includes(value.type.split(';')[0])||!value.size||value.size>8*1024*1024){message('Fotoğraf, GIF, video, ses, PDF, TXT veya ZIP seç. En fazla 8 MB.');return false;}
    disposePreview();file=value;objectUrl=URL.createObjectURL(value);preview.hidden=false;
    const element=document.createElement(value.type.startsWith('image/')?'img':value.type.startsWith('audio/')?'audio':value.type.startsWith('video/')?'video':'div');
    if(element.tagName==='DIV'){element.className='dm-file-tile';element.innerHTML=dmIcon('file');}else{element.src=objectUrl;element.alt='Gönderilecek fotoğraf';if(element.tagName!=='IMG')element.controls=true;}
    const label=document.createElement('span');const title=document.createElement('strong'),detail=document.createElement('small');title.textContent=value.name;detail.textContent=`${(value.size/1024/1024).toFixed(2)} MB · ${value.type.split('/')[1].toUpperCase()}`;label.append(title,detail);
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Eki kaldır');remove.onclick=()=>{disposePreview();message('');input.focus();};
    preview.append(element,label,remove);message('Göndermeden önce kontrol edebilirsin.');input.focus();
    return true;
  };
  const closeCamera=()=>{capture.cancel();dialog?.remove();dialog=null;recording=false;clearInterval(meterTimer);meterContext?.close().catch(()=>{});meterContext=null;const panel=form.querySelector('[data-record-panel]');if(panel)panel.hidden=true;form.classList.remove('is-recording');form.querySelector('[data-stop]').hidden=true;form.querySelector('[data-cancel]').hidden=true;if(!disposed&&form.isConnected)input.focus();};
  const fail=error=>{closeCamera();message(error.name==='NotAllowedError'?'Kamera veya mikrofon izni verilmedi. Tarayıcı izinlerini kontrol et.':error.message||'Kayıt açılamadı');};
  const recorded=blob=>{const automatic=autoVoice;autoVoice=false;closeCamera();const ready=setFile(new File([blob],`${blob.type.startsWith('audio/')?'ses':'video'}-${Date.now()}.${blob.type.includes('mp4')?'mp4':'webm'}`,{type:blob.type}));if(automatic&&ready&&!disposed)form.requestSubmit();};
  const tick=seconds=>{form.classList.add('is-recording');const time=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;const timer=form.querySelector('[data-record-time]');if(timer)timer.textContent=time;message(`● ${time} · ${hold?'Göndermek için bırak · İptal: sola sürükle':'Kaydı bitirip önizleyebilirsin'}`);};
  const startMeter=stream=>{const panel=form.querySelector('[data-record-panel]'),Context=window.AudioContext||window.webkitAudioContext;if(!panel)return;panel.hidden=false;if(!Context)return;try{meterContext=new Context();const analyser=meterContext.createAnalyser();analyser.fftSize=64;meterContext.createMediaStreamSource(stream).connect(analyser);const values=new Uint8Array(analyser.frequencyBinCount),bars=[...panel.querySelectorAll('i')];meterTimer=setInterval(()=>{analyser.getByteFrequencyData(values);bars.forEach((bar,index)=>bar.style.height=`${5+values[index]/255*37}px`);},80);}catch{ /* Recording remains available if the level meter is unsupported. */ }};
  const startVoice=async()=>{
    if(recording||busy)return;
    if(!devices?.getUserMedia){message('Bu tarayıcı mikrofon kaydını desteklemiyor. HTTPS üzerinden veya desteklenen bir tarayıcıda aç.');return;}
    capture.cancel();recording=true;message('Mikrofon izni bekleniyor…');form.querySelector('[data-cancel]').hidden=false;
    try{const stream=await capture.acquire({audio:true});if(disposed)return capture.cancel();if(hold)hold.started=Date.now();form.querySelector('[data-stop]').hidden=false;capture.record(stream,'audio',recorded,fail,tick);startMeter(stream);}catch(error){if(recording&&error.message!=='Kayıt iptal edildi')fail(error);}
  };
  const openCamera=async()=>{
    if(recording||busy)return;
    if(!devices?.getUserMedia){message('Bu tarayıcı kamera erişimini desteklemiyor. HTTPS üzerinden veya desteklenen bir tarayıcıda aç.');return;}
    capture.cancel();recording=true;
    dialog=document.createElement('dialog');dialog.className='dm-camera-dialog';dialog.innerHTML='<header><strong>Kamera · Fotoğraf / Video</strong><button type="button" data-close aria-label="Kamerayı kapat">×</button></header><video autoplay muted playsinline></video><p data-camera-status>Kamera izni bekleniyor…</p><div><button type="button" data-photo disabled>Fotoğraf çek</button><button type="button" data-video disabled>Video kaydet</button><button type="button" data-camera-flip disabled aria-label="Ön veya arka kamerayı değiştir">⟳</button><button type="button" data-video-stop hidden>Kaydı bitir</button></div>';
    document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=closeCamera;dialog.oncancel=event=>{event.preventDefault();closeCamera();};
    const current=dialog;
    try{
      let facing='user',stream=await capture.acquire({video:{width:{ideal:1280},height:{ideal:720},facingMode:{ideal:facing}},audio:false});if(disposed||dialog!==current)return capture.cancel();
      const video=current.querySelector('video');video.srcObject=stream;await video.play();
      const photo=current.querySelector('[data-photo]'), record=current.querySelector('[data-video]');photo.disabled=false;record.disabled=false;current.querySelector('[data-camera-status]').textContent='Fotoğraf çek veya en fazla 20 saniyelik video kaydet.';
      const flip=current.querySelector('[data-camera-flip]');flip.disabled=false;flip.onclick=async()=>{flip.disabled=true;photo.disabled=true;record.disabled=true;capture.cancel();facing=facing==='user'?'environment':'user';try{stream=await capture.acquire({video:{width:{ideal:1280},height:{ideal:720},facingMode:{ideal:facing}},audio:false});if(dialog!==current)return;video.srcObject=stream;await video.play();photo.disabled=false;record.disabled=false;flip.disabled=false;}catch(error){if(dialog===current)fail(error);}};
      photo.onclick=()=>{const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;if(!canvas.width)return;canvas.getContext('2d').drawImage(video,0,0);canvas.toBlob(blob=>{if(dialog!==current||!blob)return;closeCamera();setFile(new File([blob],`foto-${Date.now()}.jpg`,{type:'image/jpeg'}));},'image/jpeg',0.85);};
      record.onclick=async()=>{
        record.disabled=true;photo.disabled=true;flip.disabled=true;
        try{const mic=await capture.acquire({audio:true});if(dialog!==current)return;const combined=new MediaStream([...stream.getVideoTracks(),...mic.getAudioTracks()]);capture.record(combined,'video',recorded,fail,seconds=>{if(dialog===current)current.querySelector('[data-camera-status]').textContent=`Video kaydı · ${seconds}/20 saniye`;});current.querySelector('[data-video-stop]').hidden=false;current.querySelector('[data-video-stop]').onclick=()=>capture.stop();}
        catch(error){if(dialog===current){record.disabled=false;photo.disabled=false;flip.disabled=false;current.querySelector('[data-camera-status]').textContent='Video sesi için mikrofon izni gerekli. Tekrar deneyebilir veya fotoğraf çekebilirsin.';}}
      };
    }catch(error){if(dialog===current)fail(error);}
  };
  form.querySelector('[data-gallery]').onclick=()=>form.querySelector('input[type=file]').click();
  form.querySelector('input[type=file]').onchange=event=>{if(event.target.files[0])setFile(event.target.files[0]);event.target.value='';};
  const micButton=form.querySelector('[data-mic]');
  micButton.onclick=event=>{if(event.detail===0)startVoice();};
  micButton.onpointerdown=event=>{if(event.button!==0||recording||busy)return;event.preventDefault();hold={x:event.clientX,started:0};micButton.setPointerCapture(event.pointerId);startVoice();};
  micButton.onpointermove=event=>{if(hold&&event.clientX<hold.x-90){hold=null;autoVoice=false;closeCamera();message('Ses kaydı iptal edildi');}};
  micButton.onpointerup=()=>{if(!hold)return;const started=hold.started;hold=null;if(!started||Date.now()-started<400){autoVoice=false;closeCamera();message('Kayıt için düğmeyi basılı tut.');return;}autoVoice=true;capture.stop();};
  micButton.onpointercancel=()=>{if(hold){hold=null;autoVoice=false;closeCamera();message('Ses kaydı iptal edildi');}};
  form.querySelector('[data-camera]').onclick=openCamera;
  form.querySelector('[data-stop]').onclick=()=>{hold=null;autoVoice=false;capture.stop();};form.querySelector('[data-cancel]').onclick=()=>{hold=null;autoVoice=false;closeCamera();message('Kayıt iptal edildi');input.focus();};
  const addMenu=form.querySelector('[data-add-menu]'),picker=form.querySelector('[data-picker]');
  const hideMenus=()=>{if(addMenu)addMenu.hidden=true;if(picker)picker.hidden=true;form.querySelector('[data-add]')?.setAttribute('aria-expanded','false');};
  if(addMenu){
    form.querySelector('[data-add]').onclick=()=>{const opening=addMenu.hidden;hideMenus();addMenu.hidden=!opening;form.querySelector('[data-add]').setAttribute('aria-expanded',String(opening));if(opening)addMenu.querySelector('button').focus();};
    form.querySelector('[data-add-close]').onclick=()=>{hideMenus();input.focus();};
    form.querySelector('[data-add-gallery]').onclick=()=>{hideMenus();form.querySelector('input[type=file]').click();};
    form.querySelector('[data-add-camera]').onclick=()=>{hideMenus();openCamera();};
    form.querySelector('[data-add-voice]').onclick=()=>{hideMenus();startVoice();};
    form.querySelector('[data-add-file]').onclick=()=>{hideMenus();form.querySelector('[data-document-file]').click();};
    form.querySelector('[data-document-file]').onchange=event=>{const value=event.target.files[0];if(value){const inferred=value.type||(/\.txt$/i.test(value.name)?'text/plain':/\.zip$/i.test(value.name)?'application/zip':/\.pdf$/i.test(value.name)?'application/pdf':'');setFile(new File([value],value.name,{type:inferred}));}event.target.value='';};
  }
  if(picker){
    let mode='emoji',category='Yüzler';const search=picker.querySelector('[data-picker-search]'),categories=picker.querySelector('[data-picker-categories]'),results=picker.querySelector('[data-picker-results]');
    const renderPicker=()=>{
      picker.querySelectorAll('[data-picker-tab]').forEach(button=>button.classList.toggle('active',button.dataset.pickerTab===mode));
      categories.replaceChildren();results.replaceChildren();results.classList.toggle('emoji-grid',mode==='emoji');
      if(mode==='emoji'){
        Object.keys(window.dmCatalog.emojis).forEach(name=>{const button=document.createElement('button');button.type='button';button.textContent=name;button.classList.toggle('active',category===name);button.onclick=()=>{category=name;renderPicker();};categories.append(button);});
        const items=window.dmCatalog.search(search.value?Object.values(window.dmCatalog.emojis).flat():window.dmCatalog.emojis[category],search.value);
        items.forEach(([emoji,label])=>{const button=document.createElement('button');button.type='button';button.textContent=emoji;button.title=label;button.setAttribute('aria-label',label);button.onclick=()=>{input.setRangeText(emoji,input.selectionStart,input.selectionEnd,'end');onDraft(input.value);input.focus();};results.append(button);});
      }else{
        const label=document.createElement('small');label.textContent=mode==='gif'?'YAAS hareketli GIF koleksiyonu':'YAAS hareketli çıkartmaları';categories.append(label);
        window.dmCatalog.search(mode==='gif'?window.dmCatalog.gifs:window.dmCatalog.stickers,search.value).forEach(item=>{const button=document.createElement('button');button.type='button';const img=document.createElement('img');img.src=item.src;img.alt=item.title;button.append(img);button.setAttribute('aria-label',item.title);button.onclick=async()=>{button.disabled=true;try{const response=await fetch(item.src);if(!response.ok)throw new Error('GIF yüklenemedi');setFile(new File([await response.blob()],item.id+'.gif',{type:'image/gif'}));hideMenus();}catch(error){message(error.message);}finally{button.disabled=false;}};results.append(button);});
      }
      if(!results.children.length){const empty=document.createElement('p');empty.textContent='Sonuç bulunamadı. Başka bir kelime dene.';results.append(empty);}
    };
    const openPicker=value=>{const opening=picker.hidden||mode!==value;hideMenus();if(opening){mode=value;search.value='';picker.hidden=false;search.placeholder=mode==='gif'?'GIF ara…':'Emoji ara…';renderPicker();search.focus();}};
    form.querySelector('[data-emoji]').onclick=()=>openPicker('emoji');form.querySelector('[data-gif]').onclick=()=>openPicker('gif');
    picker.querySelectorAll('[data-picker-tab]').forEach(button=>button.onclick=()=>{mode=button.dataset.pickerTab;search.value='';renderPicker();});
    search.oninput=renderPicker;picker.querySelector('[data-picker-close]').onclick=()=>{hideMenus();input.focus();};
  }
  const onOutside=event=>{if(!form.contains(event.target))hideMenus();};
  const onEscape=event=>{if(event.key==='Escape'){hideMenus();if(recording){hold=null;autoVoice=false;closeCamera();message('Kayıt iptal edildi');}input.focus();}};
  document.addEventListener('pointerdown',onOutside);form.addEventListener('keydown',onEscape);
  input.oninput=()=>onDraft(input.value);
  input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit();}};
  input.addEventListener('paste',event=>{const item=[...event.clipboardData.items].find(item=>item.kind==='file');if(item){event.preventDefault();setFile(item.getAsFile());}});
  form.ondragover=event=>event.preventDefault();form.ondrop=event=>{event.preventDefault();if(event.dataTransfer.files[0])setFile(event.dataTransfer.files[0]);};
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||recording||(!input.value.trim()&&!file))return;
    const original=input.value,selectedFile=file;busy=true;sendButton.disabled=true;input.focus();message('Gönderiliyor…');
    try{
      let attachment;
      if(selectedFile){const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Dosya okunamadı'));reader.readAsDataURL(selectedFile);});attachment={name:selectedFile.name,data};}
      await send({content:original.trim(),attachment});
      if(input.value===original){input.value='';onDraft('');}if(file===selectedFile)disposePreview();message('');
    }catch(error){message(error.message||'Mesaj gönderilemedi. Tekrar deneyebilirsin.');}
    finally{busy=false;sendButton.disabled=false;if(!disposed&&(document.activeElement===input||document.activeElement===sendButton))input.focus();}
  };
  const dispose=()=>{if(disposed)return;disposed=true;hold=null;autoVoice=false;closeCamera();disposePreview();observer.disconnect();document.removeEventListener('pointerdown',onOutside);window.removeEventListener('pagehide',dispose);};
  const observer=new MutationObserver(()=>{if(!form.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('pagehide',dispose);
  input.focus();return dispose;
};
