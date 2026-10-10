"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {TABLES,readSnapshot,secureConnection}=require('./migrate-sqlite');
function encryptionKey(){if(!/^[a-f0-9]{64}$/i.test(process.env.YAAS_BACKUP_KEY||''))throw Error('BACKUP_KEY_REQUIRED');return Buffer.from(process.env.YAAS_BACKUP_KEY,'hex');}
function encrypt(snapshot,key){const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);const payload=Buffer.concat([cipher.update(JSON.stringify({version:1,createdAt:new Date().toISOString(),snapshot},(_key,value)=>value instanceof Uint8Array?{type:'Buffer',data:Array.from(value)}:value)),cipher.final()]);return JSON.stringify({version:1,nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),payload:payload.toString('base64')});}
function decrypt(value,key){const envelope=JSON.parse(value);if(envelope.version!==1)throw Error('BACKUP_VERSION');const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.nonce,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.payload,'base64')),decipher.final()]).toString());}
async function createBackup(output){
  const key=encryptionKey();let snapshot;
  if(process.env.DATABASE_URL){const {Client}=require('pg'),client=new Client(secureConnection(process.env.DATABASE_URL));await client.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');snapshot={};for(const table of TABLES)snapshot[table]=(await client.query(`SELECT * FROM "${table}"`)).rows;await client.query('COMMIT');}finally{await client.end();}}
  else snapshot=readSnapshot(process.env.LOCAL_DATABASE_PATH,{allowEmpty:true});
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,encrypt(snapshot,key),{flag:'wx',mode:0o600});
  return {created:true,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'),counts:Object.fromEntries(TABLES.map(t=>[t,snapshot[t]?.length||0]))};
}
async function restoreSqlite(input,target){
  if(fs.existsSync(target))throw Error('RESTORE_TARGET_MUST_NOT_EXIST');
  const data=decrypt(fs.readFileSync(input,'utf8'),encryptionKey());if(data.version!==1||Object.keys(data.snapshot).some(t=>!TABLES.includes(t)))throw Error('INVALID_SNAPSHOT');
  if(process.env.DATABASE_URL)throw Error('ISOLATED_SQLITE_ONLY');
  process.env.LOCAL_DATABASE_PATH=target;
  const {initializeDatabase,getPool}=require('../src/database');await initializeDatabase();await getPool().end();
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(target);const counts={};
  try{db.exec('PRAGMA foreign_keys=ON; BEGIN; PRAGMA defer_foreign_keys=ON;');
    for(const table of TABLES){const fields=new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name));for(const row of data.snapshot[table]||[]){const columns=Object.keys(row);if(columns.some(c=>!fields.has(c)))throw Error('UNKNOWN_COLUMN');const values=columns.map(c=>{const v=row[c];if(v&&v.type==='Buffer')return Buffer.from(v.data);if(typeof v==='boolean')return v?1:0;if(v&&typeof v==='object')return JSON.stringify(v);return v;});db.prepare(`INSERT INTO "${table}" (${columns.map(c=>'"'+c+'"').join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...values);}counts[table]=db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;if(counts[table]!== (data.snapshot[table]||[]).length)throw Error('COUNT_MISMATCH');}
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('FOREIGN_KEYS_FAILED');db.exec('COMMIT');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('INTEGRITY_FAILED');return {restored:true,counts};
  }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}
}
if(require.main===module){const [command,input,target]=process.argv.slice(2);(command==='create'&&input?createBackup(path.resolve(input)):command==='restore-test'&&input&&target?restoreSqlite(path.resolve(input),path.resolve(target)):Promise.reject(Error('USAGE_CREATE_OR_RESTORE_TEST'))).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error('Backup operation failed:',/^[A-Z_]+$/.test(e.message)?e.message:'CHECK_CONFIGURATION');process.exitCode=1;});}
module.exports={encrypt,decrypt,createBackup,restoreSqlite};
