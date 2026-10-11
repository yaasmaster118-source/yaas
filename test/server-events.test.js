'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events'),{DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
test('server events persist, stay inside membership and stream audience is enforced', {timeout:60000},async()=>{
 const dbPath=path.join(os.tmpdir(),'yaas-events-'+crypto.randomUUID()+'.sqlite');let child,db;
 async function start(){child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'4198',DATABASE_URL:'',LOCAL_DATABASE_PATH:dbPath},windowsHide:true,stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),15000);child.stdout.on('data',data=>{if(String(data).includes('YAAS is running')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited'));});child.once('error',reject);});}
 async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
 const req=async(route,cookie,body,method=body?'POST':'GET')=>{const r=await fetch('http://localhost:4198'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
  await start();const users=[];for(const name of ['Owner','Member','Outside'])users.push(await req('/api/auth/register',null,{name,email:name.toLowerCase()+'-events@example.com',password:'Test-events-1234'}));const [owner,member,outside]=users;assert.ok(owner.cookie);assert.ok(member.cookie);
  const created=await req('/api/servers',owner.cookie,{name:'Event server'});assert.equal(created.status,201);const serverId=created.data.server.id;
  db=new DatabaseSync(dbPath);db.prepare('INSERT INTO memberships(server_id,user_id) VALUES(?,?)').run(serverId,member.data.user.id);
  const body={serverId,title:'Real server event',startsAt:new Date(Date.now()+86400000).toISOString(),type:'Toplantı',location:'Online',description:'Persistent announcement'};
  assert.equal((await req('/api/events',outside.cookie,body)).status,404);assert.equal((await req('/api/events',owner.cookie,{...body,startsAt:'2020-01-01'})).status,400);assert.equal((await req('/api/events',owner.cookie,{...body,title:'   '})).status,400);
  const event=await req('/api/events',owner.cookie,body);assert.equal(event.status,201);const id=event.data.event.id;
  assert.equal((await req('/api/events',member.cookie)).data.events[0].id,id);assert.equal((await req('/api/events',outside.cookie)).data.events.length,0);
  assert.equal((await req('/api/events/'+id,outside.cookie,null,'DELETE')).status,404);assert.equal((await req('/api/events/'+id,member.cookie,null,'DELETE')).status,403);
  assert.equal(db.prepare('SELECT title FROM server_events WHERE id=?').get(id).title,body.title);db.close();db=null;
  await stop();await start();assert.equal((await req('/api/events',member.cookie)).data.events[0].id,id);
  const memberEvent=await req('/api/events',member.cookie,{...body,title:'Member plan'});assert.equal(memberEvent.status,201);assert.equal((await req('/api/events/'+memberEvent.data.event.id,owner.cookie,null,'DELETE')).status,200);
  const privateStream=await req('/api/streams',owner.cookie,{serverId,title:'Private audience',visibility:'server'});assert.equal(privateStream.status,201);const privateId=privateStream.data.stream.id;
  assert.ok((await req('/api/streams',member.cookie)).data.streams.servers.some(s=>s.id===privateId));assert.ok(!(await req('/api/streams',outside.cookie)).data.streams.servers.some(s=>s.id===privateId));
  assert.equal((await req('/api/stream-rtc/join',outside.cookie,{streamId:privateId,clientId:'outsider',role:'viewer'})).status,403);assert.equal((await req('/api/stream-rtc/join',member.cookie,{streamId:privateId,clientId:'member',role:'viewer'})).status,200);
  const publicStream=await req('/api/streams',owner.cookie,{title:'Public audience',visibility:'global'});assert.equal(publicStream.status,201);assert.ok((await req('/api/streams',outside.cookie)).data.streams.global.some(s=>s.id===publicStream.data.stream.id));assert.equal((await req('/api/stream-rtc/join',outside.cookie,{streamId:publicStream.data.stream.id,clientId:'public-viewer',role:'viewer'})).status,200);
  await req('/api/streams/'+privateId,owner.cookie,null,'DELETE');await req('/api/streams/'+publicStream.data.stream.id,owner.cookie,null,'DELETE');
  assert.equal((await req('/api/events/'+id,owner.cookie,null,'DELETE')).status,200);assert.equal((await req('/api/events',member.cookie)).data.events.length,0);
 }finally{db?.close();await stop();for(const suffix of ['','-wal','-shm'])fs.rmSync(dbPath+suffix,{force:true});}
});
