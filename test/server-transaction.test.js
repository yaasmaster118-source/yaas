'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('server creation reads its summary through the same transaction connection',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/api.js'),'utf8');const context={query(){throw Error('Uncommitted data cannot be read through another connection');},crypto:{randomUUID:()=> 'test-id'},profileImageValue:()=>'',text:(v)=>String(v||''),ROLE_TEMPLATES:[{name:'Owner',permissions:[]}],roleIconValue:()=>'',SERVER_TEMPLATES:{custom:[]}};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function serverSummary('),source.indexOf('function avatarFrame('))+source.slice(source.indexOf('async function createServer('),source.indexOf('async function handleApi(')),context);
 let reads=0;const client={async query(sql){if(sql.includes('SELECT s.id')){reads++;return{rows:[{id:'test-id',name:'New server',member_count:1}]};}return{rows:[]};}};
 const result=await context.createServer(client,{id:'owner'},{name:'New server'});assert.equal(result.id,'test-id');assert.equal(reads,1);
});
