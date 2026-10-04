"use strict";
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
  let file=null,objectUrl=null,dialog=null,busy=false,disposed=false,recording=false;
  input.value=draft||'';
  const message=value=>{status.textContent=value;};
  const disposePreview=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;file=null;preview.replaceChildren();preview.hidden=true;};
  const setFile=value=>{
    if(disposed)return;
    const allowed=['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/ogg','audio/wav','video/webm','video/mp4'];
    if(!allowed.includes(value.type.split(';')[0])||!value.size||value.size>8*1024*1024){message('JPEG, PNG, WebP, WebM, MP4, Ogg veya WAV seç. En fazla 8 MB.');return;}
    disposePreview();file=value;objectUrl=URL.createObjectURL(value);preview.hidden=false;
    const element=document.createElement(value.type.startsWith('image/')?'img':value.type.startsWith('audio/')?'audio':'video');
    element.src=objectUrl;element.alt='Gönderilecek fotoğraf';if(element.tagName!=='IMG')element.controls=true;
    const label=document.createElement('span');label.textContent=`${value.name} · ${(value.size/1024/1024).toFixed(2)} MB`;
    const remove=document.createElement('button');remove.type='button';remove.textContent='Kaldır';remove.onclick=()=>{disposePreview();message('');input.focus();};
    preview.append(element,label,remove);message('Göndermeden önce kontrol edebilirsin.');input.focus();
  };
  const closeCamera=()=>{capture.cancel();dialog?.remove();dialog=null;recording=false;form.querySelector('[data-stop]').hidden=true;form.querySelector('[data-cancel]').hidden=true;if(!disposed&&form.isConnected)input.focus();};
  const fail=error=>{closeCamera();message(error.name==='NotAllowedError'?'Kamera veya mikrofon izni verilmedi. Tarayıcı izinlerini kontrol et.':error.message||'Kayıt açılamadı');};
  const recorded=blob=>{closeCamera();setFile(new File([blob],`${blob.type.startsWith('audio/')?'ses':'video'}-${Date.now()}.${blob.type.includes('mp4')?'mp4':'webm'}`,{type:blob.type}));};
  const tick=seconds=>message(`Kayıt sürüyor · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} — durdurup önizle`);
  const startVoice=async()=>{
    if(recording||busy)return;
    if(!devices?.getUserMedia){message('Bu tarayıcı mikrofon kaydını desteklemiyor. HTTPS üzerinden veya desteklenen bir tarayıcıda aç.');return;}
    capture.cancel();recording=true;message('Mikrofon izni bekleniyor…');form.querySelector('[data-cancel]').hidden=false;
    try{const stream=await capture.acquire({audio:true});if(disposed)return capture.cancel();form.querySelector('[data-stop]').hidden=false;capture.record(stream,'audio',recorded,fail,tick);}catch(error){if(recording&&error.message!=='Kayıt iptal edildi')fail(error);}
  };
  const openCamera=async()=>{
    if(recording||busy)return;
    if(!devices?.getUserMedia){message('Bu tarayıcı kamera erişimini desteklemiyor. HTTPS üzerinden veya desteklenen bir tarayıcıda aç.');return;}
    capture.cancel();recording=true;
    dialog=document.createElement('dialog');dialog.className='dm-camera-dialog';dialog.innerHTML='<header><strong>Kamera</strong><button type="button" data-close aria-label="Kamerayı kapat">×</button></header><video autoplay muted playsinline></video><p data-camera-status>Kamera izni bekleniyor…</p><div><button type="button" data-photo disabled>Fotoğraf çek</button><button type="button" data-video disabled>Video kaydet</button><button type="button" data-video-stop hidden>Kaydı bitir</button></div>';
    document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=closeCamera;dialog.oncancel=event=>{event.preventDefault();closeCamera();};
    const current=dialog;
    try{
      const stream=await capture.acquire({video:{width:{ideal:1280},height:{ideal:720}},audio:false});if(disposed||dialog!==current)return capture.cancel();
      const video=current.querySelector('video');video.srcObject=stream;await video.play();
      const photo=current.querySelector('[data-photo]'), record=current.querySelector('[data-video]');photo.disabled=false;record.disabled=false;current.querySelector('[data-camera-status]').textContent='Fotoğraf çek veya en fazla 20 saniyelik video kaydet.';
      photo.onclick=()=>{const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;if(!canvas.width)return;canvas.getContext('2d').drawImage(video,0,0);canvas.toBlob(blob=>{if(dialog!==current||!blob)return;closeCamera();setFile(new File([blob],`foto-${Date.now()}.jpg`,{type:'image/jpeg'}));},'image/jpeg',0.85);};
      record.onclick=async()=>{
        record.disabled=true;photo.disabled=true;
        try{const mic=await capture.acquire({audio:true});if(dialog!==current)return;const combined=new MediaStream([...stream.getVideoTracks(),...mic.getAudioTracks()]);capture.record(combined,'video',recorded,fail,seconds=>{if(dialog===current)current.querySelector('[data-camera-status]').textContent=`Video kaydı · ${seconds}/20 saniye`;});current.querySelector('[data-video-stop]').hidden=false;current.querySelector('[data-video-stop]').onclick=()=>capture.stop();}
        catch(error){if(dialog===current){record.disabled=false;photo.disabled=false;current.querySelector('[data-camera-status]').textContent='Video sesi için mikrofon izni gerekli. Tekrar deneyebilir veya fotoğraf çekebilirsin.';}}
      };
    }catch(error){if(dialog===current)fail(error);}
  };
  form.querySelector('[data-gallery]').onclick=()=>form.querySelector('input[type=file]').click();
  form.querySelector('input[type=file]').onchange=event=>{if(event.target.files[0])setFile(event.target.files[0]);event.target.value='';};
  form.querySelector('[data-mic]').onclick=startVoice;form.querySelector('[data-camera]').onclick=openCamera;
  form.querySelector('[data-stop]').onclick=()=>capture.stop();form.querySelector('[data-cancel]').onclick=()=>{closeCamera();message('Kayıt iptal edildi');input.focus();};
  form.querySelector('[data-emoji]').onclick=()=>{const picker=form.querySelector('[data-emojis]');picker.hidden=!picker.hidden;};
  form.querySelectorAll('[data-emojis] button').forEach(button=>button.onclick=()=>{input.setRangeText(button.textContent,input.selectionStart,input.selectionEnd,'end');onDraft(input.value);input.focus();});
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
  const dispose=()=>{if(disposed)return;disposed=true;closeCamera();disposePreview();observer.disconnect();window.removeEventListener('pagehide',dispose);};
  const observer=new MutationObserver(()=>{if(!form.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('pagehide',dispose);
  input.focus();return dispose;
};
