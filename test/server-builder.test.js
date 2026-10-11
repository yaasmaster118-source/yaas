'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {spawn} = require('node:child_process'), {once} = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
test('builder previews match persisted channels for every template and preserve identity', {timeout:60000}, async () => {
  const db = path.join(os.tmpdir(), `yaas-builder-${crypto.randomUUID()}.sqlite`);
  const child = spawn(process.execPath, ['server.js'], {cwd:path.join(__dirname,'..'), env:{...process.env,PORT:'4208',DATABASE_URL:'',LOCAL_DATABASE_PATH:db},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(Error('startup timeout')),15000); child.stdout.on('data',data=>{if(String(data).includes('YAAS is running')){clearTimeout(timer);resolve();}});child.once('error',reject); });
    async function req(route,cookie,body) {const r=await fetch('http://localhost:4208'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
    assert.equal((await req('/api/server-templates')).status,401);
    const user=await req('/api/auth/register',null,{name:'Builder test',email:'builder@example.com',password:'Builder-test-8765'}); assert.ok(user.cookie);
    const {templates}=(await req('/api/server-templates',user.cookie)).data; assert.equal(Object.keys(templates).length,7);
    assert.equal((await req('/api/servers',user.cookie,{name:'  '})).status,400);
    const {DatabaseSync}=require('node:sqlite'); const read=new DatabaseSync(db);
    try { for(const [template,categories] of Object.entries(templates)) {
      const created=await req('/api/servers',user.cookie,{name:`Test ${template}`,description:'A real description',iconColor:'#7357ed',template}); assert.equal(created.status,201);
      const server=created.data.server; assert.equal(server.name,`Test ${template}`);assert.equal(server.description,'A real description');assert.equal(server.icon_color,'#7357ed');assert.equal(server.member_count,1);
      const channels=read.prepare('SELECT name,type FROM channels WHERE server_id=? ORDER BY name').all(server.id);
      const expected=categories.flatMap(category=>category.channels).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
      assert.deepEqual(channels.map(row=>({...row})),expected);
      assert.equal(read.prepare('SELECT COUNT(*) AS n FROM channel_categories WHERE server_id=?').get(server.id).n,categories.length);
    }} finally {read.close();}
  } finally {if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}for(const suffix of ['','-wal','-shm'])fs.rmSync(db+suffix,{force:true});}
});

