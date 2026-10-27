'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
for(const kind of ['events','streams'])test(`${kind}: late refresh cannot restore stale content or data from another account`,async()=>{
 const capital=kind[0].toUpperCase()+kind.slice(1),pending=[];
 const context={state:{user:{id:'first'}},api:()=>new Promise(resolve=>pending.push(resolve)),renderHomeEvents(){},renderStreams(){}};
 const start=source.indexOf(`let ${kind}LoadSequence`),end=source.indexOf(kind==='events'?'function renderEventsPage()':'async function startStream()',start);
 vm.runInNewContext(source.slice(start,end),context);
 const a=context['load'+capital](),b=context['load'+capital]();
 pending[1]({[kind]:['new']});await b;pending[0]({[kind]:['old']});await a;assert.equal(context.state[kind][0],'new');
 const c=context['load'+capital]();context.state.user={id:'another'};pending[2]({[kind]:['private-old-user']});await c;assert.equal(context.state[kind][0],'new');
});
