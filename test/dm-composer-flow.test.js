'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(send){
 const node=()=>({hidden:true,value:'',dataset:{},classList:{add(){},remove(){}},append(){},replaceChildren(){},setAttribute(){},addEventListener(){},focus(){},remove(){}});
 const input=node(),status=node(),preview=node(),button=node(),elements=new Map();
 for(const selector of ['textarea','[data-status]','[data-preview]','[data-send]','[data-stop]','[data-cancel]','[data-gallery]','input[type=file]','[data-mic]','[data-camera]'])elements.set(selector,node());
 elements.set('textarea',input);elements.set('[data-status]',status);elements.set('[data-preview]',preview);elements.set('[data-send]',button);
 const form={...node(),isConnected:true,contains:()=>true,querySelector:selector=>elements.get(selector)||null};
 const document={activeElement:input,body:{},addEventListener(){},removeEventListener(){},createElement(tag){return{...node(),tagName:tag.toUpperCase()};}};
 let reader,draft='';const window={addEventListener(){},removeEventListener(){}};
 class Reader{readAsDataURL(){reader=this;}}
 class Observer{observe(){}disconnect(){}}
 const context={window,document,navigator:{mediaDevices:{}},MutationObserver:Observer,FileReader:Reader,File,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout,clearTimeout,setInterval,clearInterval,console};
 vm.runInNewContext(fs.readFileSync('dm-composer.js','utf8'),context);
 const dispose=window.mountDmComposer(form,{send,draft:'',onDraft:value=>draft=value});
 const attach=()=>form.ondrop({preventDefault(){},dataTransfer:{files:[new File(['image'],'photo.png',{type:'image/png'})]}});
 return{form,input,status,button,attach,dispose,finishRead(){reader.result='data:image/png;base64,aW1hZ2U=';reader.onload();},draft:()=>draft};
}
test('leaving a DM while a file is being read prevents an unsent upload',async()=>{
 let sends=0;const h=harness(async()=>sends++);h.attach();const pending=h.form.onsubmit({preventDefault(){}});h.dispose();h.form.isConnected=false;h.finishRead();await pending;assert.equal(sends,0);assert.equal(h.button.disabled,false);
});
test('DM send keeps the next draft and releases the submit button',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>finish=resolve));h.input.value='first';const pending=h.form.onsubmit({preventDefault(){}});h.input.value='next draft';finish();await pending;assert.equal(h.input.value,'next draft');assert.equal(h.button.disabled,false);
});
test('failed media send keeps its attachment available for retry',async()=>{
 let sends=0;const h=harness(async()=>{sends++;throw Error('Connection failed');});h.attach();const pending=h.form.onsubmit({preventDefault(){}});h.finishRead();await pending;assert.equal(sends,1);assert.match(h.status.textContent,/Connection failed/);assert.equal(h.button.disabled,false);const retry=h.form.onsubmit({preventDefault(){}});h.finishRead();await retry;assert.equal(sends,2);
});
