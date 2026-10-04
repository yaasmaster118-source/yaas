"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {validateDmAttachment,mediaRange}=require('../src/dm-media');
const {DmCapture}=require('../dm-composer');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=';
test('media validates signatures and range requests',()=>{
  assert.equal(validateDmAttachment({name:'photo.png',data:'data:image/png;base64,'+png}).mime,'image/png');
  assert.throws(()=>validateDmAttachment({data:'data:image/jpeg;base64,'+png}));
  assert.throws(()=>validateDmAttachment({data:'data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')}));
  assert.deepEqual(mediaRange('bytes=2-5',10),{start:2,end:5,partial:true});
  assert.deepEqual(mediaRange('bytes=-3',10),{start:7,end:9,partial:true});
  assert.equal(mediaRange('bytes=12-',10),null);assert.equal(mediaRange('bytes=-0',10),null);assert.equal(mediaRange('bytes=0-1,4-5',10),null);
});
test('cancelled permission request releases a late microphone',async()=>{
  let resolve,stopped=0;const stream={getTracks:()=>[{stop:()=>stopped++}]};
  const capture=new DmCapture({getUserMedia:()=>new Promise(r=>resolve=r)},null);
  const pending=capture.acquire({audio:true});capture.cancel();resolve(stream);
  await assert.rejects(pending,/iptal/);assert.equal(stopped,1);
});
test('recorder uses actual MIME, releases tracks and suppresses cancelled output',async()=>{
  let stopped=0,output=0;const stream={getTracks:()=>[{stop:()=>stopped++}]};
  class Recorder{static isTypeSupported(){return true;}constructor(){this.mimeType='audio/webm;codecs=opus';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['test'])});queueMicrotask(()=>this.onstop());}}
  const capture=new DmCapture({getUserMedia:async()=>stream},Recorder);
  await capture.acquire({audio:true});capture.record(stream,'audio',blob=>{assert.equal(blob.type,'audio/webm');output++;},assert.fail,()=>{});capture.stop();await new Promise(r=>setImmediate(r));assert.equal(output,1);assert.equal(stopped,1);
  await capture.acquire({audio:true});capture.record(stream,'audio',()=>output++,assert.fail,()=>{});capture.cancel();await new Promise(r=>setImmediate(r));assert.equal(output,1);assert.equal(stopped,2);
});
test('HTTP attachments persist, restrict access and support media seeking',{timeout:45000},async()=>{
  const {spawn}=require('node:child_process'),{once}=require('node:events'),{DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
  const dbPath=path.join(os.tmpdir(),`yaas-media-${crypto.randomUUID()}.sqlite`),root=path.join(__dirname,'..');
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'4196',NODE_ENV:'development',DATABASE_URL:'',OWNER_EMAIL:'',LOCAL_DATABASE_PATH:dbPath},windowsHide:true,stdio:['ignore','pipe','pipe']});let db;
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),15000);child.stdout.on('data',data=>{if(String(data).includes('YAAS is running')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Exited'));});});
    const req=(route,cookie,body,method=body?'POST':'GET',headers={})=>fetch('http://localhost:4196'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const users=[];for(let i=0;i<3;i++){const response=await req('/api/auth/register',null,{name:'Media '+i,email:`media${i}@example.com`,password:'Testing12345'});assert.equal(response.status,201);users.push({user:(await response.json()).user,cookie:response.headers.get('set-cookie').split(';')[0]});}
    const [a,b,c]=users;db=new DatabaseSync(dbPath);db.prepare("INSERT INTO friendships(requester_id,addressee_id,status) VALUES (?,?,'accepted')").run(a.user.id,b.user.id);
    const sent=await req(`/api/dms/${b.user.id}`,a.cookie,{attachment:{name:'test.png',data:'data:image/png;base64,'+png}});assert.equal(sent.status,201);const message=(await sent.json()).message;
    const route='/api/dm-attachments/'+message.attachment_id;
    assert.equal((await req(route)).status,401);assert.equal((await req(route,c.cookie)).status,404);
    const downloaded=await req(route,b.cookie);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),Buffer.from(png,'base64'));
    const partial=await req(route,b.cookie,null,'GET',{Range:'bytes=0-7'});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,8);
    assert.equal((await req(route,b.cookie,null,'GET',{Range:'bytes=99999-'})).status,416);
    const head=await req(route,b.cookie,null,'HEAD');assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
    const history=await (await req(`/api/dms/${a.user.id}`,b.cookie)).json();assert.equal(history.messages[0].attachment_id,message.attachment_id);assert.equal(history.messages[0].attachment_name,'test.png');assert.equal(history.messages[0].data,undefined);
    assert.equal((await req(`/api/dms/${b.user.id}`,a.cookie,{attachment:{name:'fake.jpg',data:'data:image/jpeg;base64,'+png}})).status,400);
    const oversized=Buffer.alloc(8*1024*1024+1);oversized.set(Buffer.from(png,'base64'));assert.equal((await req(`/api/dms/${b.user.id}`,a.cookie,{attachment:{name:'large.png',data:'data:image/png;base64,'+oversized.toString('base64')}})).status,400);
    db.prepare('UPDATE dm_attachments SET size_bytes=8388608').run();for(let i=0;i<3;i++){const id=crypto.randomUUID();db.prepare('INSERT INTO direct_messages(id,sender_id,recipient_id,content) VALUES (?,?,?,?)').run(id,a.user.id,b.user.id,'quota');db.prepare('INSERT INTO dm_attachments(id,message_id,owner_id,name,mime_type,size_bytes,data) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,a.user.id,'quota.png','image/png',8388608,Buffer.from(png,'base64'));}
    assert.equal((await req(`/api/dms/${b.user.id}`,a.cookie,{attachment:{name:'quota.png',data:'data:image/png;base64,'+png}})).status,400);
    assert.equal((await req(`/api/dms/${b.user.id}`,a.cookie,{content:'Text still works'})).status,201);
  }finally{db?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}for(const suffix of ['','-wal','-shm'])fs.rmSync(dbPath+suffix,{force:true});}
});

