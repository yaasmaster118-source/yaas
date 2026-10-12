"use strict";
const crypto=require('node:crypto');
const {query,transaction}=require('./database');
const {hashPassword}=require('./auth');
const digest=token=>crypto.createHash('sha256').update(token).digest('hex');
function emailReady(){return Boolean(process.env.RESEND_API_KEY&&process.env.SECURITY_ALERT_FROM&&process.env.PUBLIC_APP_URL);}
const resetCodeToken=(email,code)=>crypto.createHmac('sha256',process.env.SECURITY_LOG_SALT||process.env.RESEND_API_KEY||'').update(`reset-code:${String(email).trim().toLowerCase()}:${code}`).digest('base64url');
async function issueToken(user,purpose,withCode=false){
  if(!emailReady())throw Object.assign(new Error('E-posta hizmeti henüz hazır değil. Daha sonra tekrar dene.'),{statusCode:503});
  const base=new URL(process.env.PUBLIC_APP_URL);
  if(base.protocol!=='https:')throw new Error('HTTPS required');
  const code=withCode&&purpose==='reset' ? String(crypto.randomInt(0,100000000)).padStart(8,'0') : null;
  const token=code ? resetCodeToken(user.email,code) : crypto.randomBytes(32).toString('base64url');
  const id=crypto.randomUUID();
  await query('DELETE FROM account_tokens WHERE user_id=$1 AND purpose=$2',[user.id,purpose]);
  await query('INSERT INTO account_tokens(id,user_id,purpose,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5)',[id,user.id,purpose,digest(token),new Date(Date.now()+(code?10:30)*60*1000).toISOString()]);
  if(code){await query('DELETE FROM password_reset_attempts WHERE user_id=$1',[user.id]);await query('INSERT INTO password_reset_attempts(user_id,attempts) VALUES ($1,$2)',[user.id,0]);}
  base.hash=`account=${purpose}&token=${token}`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.RESEND_API_KEY}`},body:JSON.stringify({from:process.env.SECURITY_ALERT_FROM,to:[user.email],subject:purpose==='reset'?'YAAS şifre yenileme':'YAAS e-posta doğrulama',text:code?`YAAS şifre yenileme kodun: ${code}\nKod 10 dakika geçerlidir ve yalnızca bir kez kullanılabilir. Bu kodu kimseyle paylaşma. İşlemi istemediysen mesajı yok say.`:`Bu işlemi sen istediysen bağlantıyı aç: ${base.href}\nBağlantı 30 dakika geçerlidir. İstemediysen bu mesajı yok say.`}),signal:AbortSignal.timeout(10000)});
  if(!response.ok){await query('DELETE FROM account_tokens WHERE id=$1',[id]);throw Object.assign(new Error('E-posta gönderilemedi. Daha sonra tekrar dene.'),{statusCode:503});}
}
async function consumeToken(token,purpose,password){
  if(!/^[A-Za-z0-9_-]{43}$/.test(String(token||'')))return false;
  const passwordHash=purpose==='reset'?await hashPassword(password):null;
  return transaction(async client=>{
    const result=await client.query('DELETE FROM account_tokens WHERE token_hash=$1 AND purpose=$2 AND expires_at>$3 RETURNING user_id',[digest(token),purpose,new Date().toISOString()]);
    if(!result.rowCount)return false;
    const id=result.rows[0].user_id;
    if(purpose==='reset'){
      await client.query('UPDATE users SET password_hash=$2 WHERE id=$1',[id,passwordHash]);
      await client.query('DELETE FROM sessions WHERE user_id=$1',[id]);
      await client.query('DELETE FROM account_tokens WHERE user_id=$1 AND purpose=$2',[id,'reset']);
    }else await client.query('UPDATE users SET email_verified=$2 WHERE id=$1',[id,true]);
    return true;
  });
}
async function consumeResetCode(email,code,password){
  const normalized=String(email||'').trim().toLowerCase();
  const user=(await query('SELECT id FROM users WHERE email=$1',[normalized])).rows[0];
  if(!user)return false;
  const attempt=await query('UPDATE password_reset_attempts SET attempts=attempts+1 WHERE user_id=$1 AND attempts<5 RETURNING attempts',[user.id]);
  if(!attempt.rowCount)return false;
  if(!/^\d{8}$/.test(String(code||'')))return false;
  return consumeToken(resetCodeToken(normalized,code),'reset',password);
}
async function isBlocked(a,b){return (await query('SELECT 1 FROM user_blocks WHERE (user_id=$1 AND blocked_id=$2) OR (user_id=$2 AND blocked_id=$1)',[a,b])).rowCount>0;}
module.exports={emailReady,issueToken,consumeToken,consumeResetCode,isBlocked};
