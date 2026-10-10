const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
test('email tokens expire, are single-use, hide raw tokens and revoke sessions',async()=>{
  const filename=path.join(os.tmpdir(),`yaas-account-${crypto.randomUUID()}.sqlite`);
  process.env.LOCAL_DATABASE_PATH=filename;process.env.DATABASE_URL='';process.env.RESEND_API_KEY='test-only';process.env.SECURITY_ALERT_FROM='test@example.com';process.env.PUBLIC_APP_URL='https://example.com';
  const {query,getPool}=require('../src/database'),{issueToken,consumeToken}=require('../src/account-security');
  const original=global.fetch;let email;
  global.fetch=async(_url,options)=>{email=JSON.parse(options.body);return {ok:true};};
  try{
    const id=crypto.randomUUID(),user={id,email:'test@example.com'};
    await query('INSERT INTO users(id,email,display_name,handle,password_hash) VALUES ($1,$2,$3,$4,$5)',[id,user.email,'Test','test','old']);
    await query('INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)',[crypto.randomUUID(),id,'session',new Date(Date.now()+60000).toISOString()]);
    await issueToken(user,'reset');let token=email.text.match(/token=([\w-]+)/)[1];
    const stored=(await query('SELECT token_hash FROM account_tokens')).rows[0].token_hash;assert.notEqual(stored,token);
    assert.equal(await consumeToken(token,'verify'),false);
    assert.equal(await consumeToken(token,'reset','NewPassword123'),true);
    assert.equal((await query('SELECT * FROM sessions')).rowCount,0);
    assert.equal(await consumeToken(token,'reset','OtherPassword123'),false);
    await issueToken(user,'verify');token=email.text.match(/token=([\w-]+)/)[1];
    await query('UPDATE account_tokens SET expires_at=$1',['2000-01-01T00:00:00.000Z']);assert.equal(await consumeToken(token,'verify'),false);
    await issueToken(user,'verify');token=email.text.match(/token=([\w-]+)/)[1];assert.equal(await consumeToken(token,'verify'),true);
    assert.equal((await query('SELECT email_verified FROM users WHERE id=$1',[id])).rows[0].email_verified,1);
  }finally{global.fetch=original;await getPool().end();for(const suffix of ['','-wal','-shm'])fs.rmSync(filename+suffix,{force:true});}
});
test('blocked users cannot bypass DM, friend or message requests; reports are owner-only',{timeout:45000},async()=>{
  const {spawn}=require('node:child_process'),{once}=require('node:events'),{DatabaseSync}=require('node:sqlite');
  const filename=path.join(os.tmpdir(),`yaas-block-${crypto.randomUUID()}.sqlite`),root=path.join(__dirname,'..');
  const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'4195',NODE_ENV:'development',DATABASE_URL:'',OWNER_EMAIL:'',LOCAL_DATABASE_PATH:filename,RESEND_API_KEY:''},windowsHide:true,stdio:['ignore','pipe','pipe']});let db;
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),15000);child.stdout.on('data',d=>{if(String(d).includes('YAAS is running')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Exited'));});});
    const req=(route,cookie,body,method=body?'POST':'GET')=>fetch('http://localhost:4195'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const users=[];for(let i=0;i<2;i++){const r=await req('/api/auth/register',null,{name:'Block '+i,email:`block${i}@example.com`,password:'Testing12345'});assert.equal(r.status,201);users.push({user:(await r.json()).user,cookie:r.headers.get('set-cookie').split(';')[0]});}
    const [a,b]=users;db=new DatabaseSync(filename);db.prepare("INSERT INTO friendships(requester_id,addressee_id,status) VALUES (?,?,'accepted')").run(a.user.id,b.user.id);
    assert.equal((await req(`/api/dms/${b.user.id}`,a.cookie,{content:'history'})).status,201);
    assert.equal((await req(`/api/blocks/${b.user.id}`,a.cookie,{})).status,200);
    for(const [route,body] of [[`/api/dms/${a.user.id}`,{content:'bypass'}],['/api/friends/requests',{handle:a.user.handle}],['/api/message-requests',{handle:a.user.handle,content:'bypass'}]])assert.equal((await req(route,b.cookie,body)).status,403);
    assert.equal((await req(`/api/dms/${b.user.id}`,a.cookie)).status,200);
    assert.equal((await req('/api/reports',a.cookie,{targetId:b.user.id,reason:'Test abuse report'})).status,201);
    assert.equal((await req('/api/admin/reports',b.cookie)).status,403);
    db.prepare('UPDATE users SET is_site_owner=1 WHERE id=?').run(a.user.id);
    const reports=await (await req('/api/admin/reports',a.cookie)).json();assert.equal(reports.reports.length,1);
    assert.equal((await req(`/api/admin/reports/${reports.reports[0].id}`,a.cookie,{status:'closed'},'PATCH')).status,200);
    assert.equal((await req(`/api/blocks/${b.user.id}`,a.cookie,null,'DELETE')).status,200);
    assert.equal((await req(`/api/dms/${a.user.id}`,b.cookie,{content:'allowed'})).status,201);
    assert.equal((await req('/api/auth/reset-request',null,{email:a.user.email})).status,503);
  }finally{db?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}for(const suffix of ['','-wal','-shm'])fs.rmSync(filename+suffix,{force:true});}
});
