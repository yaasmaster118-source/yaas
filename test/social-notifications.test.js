'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
test('reading a conversation refreshes global unread badges immediately',async()=>{
 const calls=[],list={scrollHeight:100},person={id:'friend',unread_count:3};let summary=0,removed=0;
 const context={state:{activeDm:{id:'friend'},conversations:[person]},$:selector=>selector==='#dm-page-message-list'?list:selector==='#inbox-older'?{classList:{toggle(){}}}:{remove(){removed++;}},api:async(path,options)=>{calls.push([path,options?.method]);return{messages:[],hasMore:false};},updateDmPeerStatus(){},renderDmPageMessages(){},loadNotificationSummary:async()=>summary++,notify(error){throw Error(error);}};
 vm.runInNewContext(source.slice(source.indexOf('async function loadInboxMessages('),source.indexOf('async function toggleNotificationPanel(')),context);
 await context.loadInboxMessages(false);
 assert.equal(person.unread_count,0);assert.equal(summary,1);assert.equal(removed,1);assert.equal(calls[1][0],'/api/contacts/friend');
});
test('logging out removes notification content from the page',()=>{
 let removed=0;const state={user:{id:'old'}};
 const element={classList:{add(){},remove(){}},setAttribute(){},remove(){removed++;}};
 const context={state,$:selector=>selector==='#notification-popover'?{remove(){removed++;}}:element,window:{yaasEntrance:{show(){}}}};
 vm.runInNewContext(source.slice(source.indexOf('function showAuth()'),source.indexOf('function switchAuth(')),context);context.showAuth();assert.equal(state.user,null);assert.equal(removed,1);
});
