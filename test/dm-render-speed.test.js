'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
test('long DM histories keep order, preserve existing media nodes and avoid repeated suffix scans',()=>{
 const children=[],list={children,scrollHeight:1000,scrollTop:0,clientHeight:20,querySelector:()=>null,insertBefore(node,next){const at=next?children.indexOf(next):children.length;children.splice(at,0,node);}};
 let created=0;
 const context={$:()=>list,state:{user:{id:'self'}},document:{createElement(){created++;return{dataset:{},querySelector:()=>null};}},escapeHtml:String,dmDate:value=>new Date(value)};
 const code=source.slice(source.indexOf('function renderDmPageMessages('),source.indexOf('async function loadDmPageMessages('));
 vm.runInNewContext(code,context);
 const messages=Array.from({length:2000},(_,i)=>({id:String(i),sender_id:'other',content:String(i),created_at:'2026-10-19T00:00:00Z'}));
 messages.slice=()=>{throw Error('Quadratic suffix scan');};
 context.renderDmPageMessages(messages);
 assert.deepEqual(children.map(n=>n.dataset.messageId),Array.from({length:2000},(_,i)=>String(i)));
 const retained=children[100];context.renderDmPageMessages(messages);assert.equal(created,2000);assert.equal(children[100],retained);assert.equal(list.scrollTop,0);
 const older={id:'older',sender_id:'other',content:'older',created_at:'2026-10-18T00:00:00Z'};
 context.renderDmPageMessages([older,...messages]);assert.equal(children[0].dataset.messageId,'older');assert.equal(created,2001);
});
test('a late DM response cannot overwrite another conversation',async()=>{
 let resolve,paints=0;const list={};
 const state={activeDm:{id:'first'}};
 const context={state,$:()=>list,api:()=>new Promise(r=>resolve=r),renderDmPageMessages:()=>paints++,escapeHtml:String};
 vm.runInNewContext(source.slice(source.indexOf('async function loadDmPageMessages('),source.indexOf('function dmNotificationItems(')),context);
 const pending=context.loadDmPageMessages();state.activeDm={id:'second'};resolve({messages:[]});await pending;assert.equal(paints,0);
});

