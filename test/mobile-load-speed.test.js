'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
test('opening the DM inbox starts independent requests together and waits for all results',async()=>{
 const started=[],resolvers={},pages=[];
 const wait=name=>{started.push(name);return new Promise(resolve=>resolvers[name]=resolve);};
 const state={friends:{friends:[]}};
 const context={state,loadFriends:()=>wait('friends'),loadMessageRequests:()=>wait('requests'),api:()=>wait('inbox'),showWorkspacePage:(id)=>pages.push(id),renderDmPage(){},renderFriendsPage(){}};
 vm.runInNewContext(source.slice(source.indexOf('async function showDmPage('),source.indexOf('function streamPageCard(')),context);
 const pending=context.showDmPage('conversations');assert.deepEqual(started,['friends','requests','inbox']);assert.equal(pages.length,0);
 resolvers.inbox({conversations:[{id:'contact'}]});resolvers.requests();resolvers.friends();await pending;
 assert.equal(state.conversations[0].id,'contact');assert.deepEqual(pages,['nav-dms-button']);
});
