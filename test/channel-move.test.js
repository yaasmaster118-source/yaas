'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const code=source.slice(source.indexOf('async function moveManagedChannel('),source.indexOf('function bindChannelManagement()'));
for(const navigated of [false,true]) test(`moving a channel preserves the current conversation; navigated=${navigated}`,async()=>{
  const state={activeServer:{server:{id:'original'}},activeChannel:{id:'conversation'}},opened=[];
  const context={state,canManageChannels:()=>true,notify:()=>{},api:async()=>{if(navigated)state.activeServer={server:{id:'another'}};},openServer:async(...args)=>opened.push(args)};
  vm.runInNewContext(code,context);
  await context.moveManagedChannel('moved','category');
  assert.deepEqual(opened,navigated?[]:[['original','conversation']]);
});
