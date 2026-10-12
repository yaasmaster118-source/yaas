'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('channel send shows pending immediately, preserves next draft and avoids history reload',async()=>{
const source=fs.readFileSync('app.js','utf8'),start=source.indexOf('$("#message-form").addEventListener("submit"'),end=source.indexOf('$("#message-input").addEventListener("input"',start);
let submit,resolve,calls=[];const nodes={};const input={value:'hello',focus(){}};
const list={scrollHeight:10,querySelector(){return null;},append(node){nodes.pending=node;}};
const form={addEventListener(_,fn){submit=fn;}};
const doc={createElement(){return{isConnected:true,append(){}};}};
vm.runInNewContext(source.slice(start,end),{document:doc,$:id=>({'#message-form':form,'#message-input':input,'#message-list':list,'#mention-suggestions':{classList:{add(){}}}}[id]),state:{user:{display_name:'Alice'},activeChannel:{id:'a'}},messageTemplate:m=>m.content,api:(url)=>{calls.push(url);return new Promise(r=>resolve=r);},notify(){}});
const sent=submit({preventDefault(){}});assert.equal(input.value,'');assert.equal(nodes.pending.innerHTML,'hello');input.value='next draft';resolve({message:{content:'hello'}});await sent;assert.equal(input.value,'next draft');assert.equal(calls.length,1);assert.equal(nodes.pending.className,'');
});
