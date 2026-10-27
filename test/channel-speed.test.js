'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
test('channel loads ignore stale replies and immediately show recent public history',async()=>{
const source=fs.readFileSync('app.js','utf8');const list={innerHTML:'',scrollHeight:10};const pending=[];const state={user:{id:'u'},activeChannel:{id:'a',type:'text'}};
const context={state,AbortController,Date,Map,$:()=>list,messageTemplate:m=>m.content,notify(){},api:()=>new Promise(resolve=>pending.push(resolve))};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('let channelMessageRequest;'),source.indexOf('async function voiceApi')),context);
const a=context.loadMessages();assert.match(list.innerHTML,/yükleniyor/);state.activeChannel={id:'b',type:'text'};const b=context.loadMessages();pending[0]({messages:[{content:'old a'}]});await a;assert.ok(!list.innerHTML.includes('old a'));pending[1]({messages:[{content:'new b'}]});await b;assert.equal(list.innerHTML,'new b');const again=context.loadMessages();assert.equal(list.innerHTML,'new b');pending[2]({messages:[{content:'fresh b'}]});await again;assert.equal(list.innerHTML,'fresh b');
state.activeChannel={id:'private',type:'text',is_private:true};const priv=context.loadMessages();pending[3]({messages:[{content:'private text'}]});await priv;const privAgain=context.loadMessages();assert.match(list.innerHTML,/yükleniyor/);pending[4]({messages:[]});await privAgain;
});
test('an unchanged cached channel response does not repaint the message list twice',async()=>{
const source=fs.readFileSync('app.js','utf8');let writes=0,html='';const list={scrollHeight:10,set innerHTML(value){writes++;html=value;},get innerHTML(){return html;}};
const messages=[{id:'one',content:'hello'}];
const context={state:{user:{id:'u'},activeChannel:{id:'a',type:'text'}},AbortController,Date,Map,JSON,$:()=>list,messageTemplate:m=>m.content,notify(){},api:async()=>({messages})};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let channelMessageRequest;'),source.indexOf('async function voiceApi')),context);
await context.loadMessages();writes=0;await context.loadMessages();assert.equal(writes,1);assert.equal(html,'hello');
});
