const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('encrypted backup detects tampering and restores real account and media rows',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'yaas-backup-test-'));process.env.LOCAL_DATABASE_PATH=path.join(directory,'source.sqlite');process.env.DATABASE_URL='';process.env.OWNER_EMAIL='';process.env.YAAS_BACKUP_KEY=crypto.randomBytes(32).toString('hex');
  const {query,getPool}=require('../src/database'),{createBackup,restoreSqlite,decrypt}=require('../scripts/backup');
  try{const id=crypto.randomUUID(),other=crypto.randomUUID(),message=crypto.randomUUID();for(const user of [id,other])await query('INSERT INTO users(id,email,display_name,handle,password_hash) VALUES ($1,$2,$3,$4,$5)',[user,user+'@example.com','Backup',user,'hash']);
    await query('INSERT INTO direct_messages(id,sender_id,recipient_id,content) VALUES ($1,$2,$3,$4)',[message,id,other,'Persistent message']);
    await query('INSERT INTO dm_attachments(id,message_id,owner_id,name,mime_type,size_bytes,data) VALUES ($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),message,id,'note.txt','text/plain',5,Buffer.from('hello')]);
    await getPool().end();const backup=path.join(directory,'backup.enc');const result=await createBackup(backup);assert.equal(result.counts.users,2);assert.ok(!fs.readFileSync(backup,'utf8').includes('Persistent message'));
    assert.throws(()=>decrypt(fs.readFileSync(backup,'utf8'),crypto.randomBytes(32)));
    const target=path.join(directory,'restored.sqlite');const restored=await restoreSqlite(backup,target);assert.equal(restored.counts.users,2);assert.equal(restored.counts.dm_attachments,1);await assert.rejects(restoreSqlite(backup,target),/MUST_NOT_EXIST/);
    const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(target);try{assert.equal(Buffer.from(db.prepare('SELECT data FROM dm_attachments').get().data).toString(),'hello');}finally{db.close();}
  }finally{await getPool().end();fs.rmSync(directory,{recursive:true,force:true});}
});
