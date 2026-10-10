"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

test("production HTTP protects internal files, admin, private channels, sessions and input", { timeout: 45000 }, async () => {
  const dbPath = path.join(os.tmpdir(), `yaas-security-${crypto.randomUUID()}.sqlite`);
  const child = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: "4189", NODE_ENV: "production", OWNER_EMAIL: "reserved@example.com", DATABASE_URL: "", LOCAL_DATABASE_PATH: dbPath, SECURITY_ALERT_WEBHOOK_URL: "", TRUST_PROXY: "", TRUST_CLOUDFLARE: "" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let db;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Startup timeout")), 15000);
      child.stdout.on("data", data => { if (String(data).includes("YAAS is running")) { clearTimeout(timer); resolve(); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Server exited")); });
      child.once("error", reject);
    });
    const req = async (route, cookie, body, method = body === undefined ? "GET" : "POST") => {
      const response = await fetch(`http://localhost:4189${route}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
      const raw = await response.text();
      return { status: response.status, headers: response.headers, data: (() => { try { return JSON.parse(raw); } catch { return raw; } })(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
    };
    for (const route of ["/server.js", "/src/auth.js", "/.env", "/.git/config", "/schema.sql", "/package.json", "/.data/yaas.sqlite"]) assert.equal((await req(route)).status, 404, route);
    const health = await req("/health");
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("x-frame-options"), "DENY");
    assert.match(health.headers.get("strict-transport-security"), /max-age/);
    assert.match(health.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal((await req("/api/servers")).status, 401);
    assert.equal((await req("/api/auth/register", null, { name: "Reserved", email: "reserved@example.com", password: "Testing12345" })).status, 403);
    const a = await req("/api/auth/register", null, { name: "User A", email: "a@example.com", password: "Testing12345", is_site_owner: true });
    const b = await req("/api/auth/register", null, { name: "User B", email: "b@example.com", password: "Testing12345" });
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    assert.equal(a.data.user.is_site_owner, false);
    assert.match(a.headers.get("set-cookie"), /HttpOnly/);
    assert.match(a.headers.get("set-cookie"), /Secure/);
    assert.equal(JSON.stringify(a.data).includes("password"), false);
    assert.equal((await req("/api/admin/security/summary", a.cookie)).status, 403);
    assert.equal((await req(`/api/dms/${b.data.user.id}`, a.cookie)).status, 403);
    assert.equal((await req("/api/me/profile", a.cookie, { avatarUrl: "data:image/png;base64,ZmFrZQ==" }, "PATCH")).status, 400);
    assert.equal((await req("/api/me/profile", a.cookie, "{", "PATCH")).status, 400);
    assert.equal((await req("/api/me/profile", a.cookie, { bio: "x".repeat(450001) }, "PATCH")).status, 413);
    assert.equal((await req("/api/servers", "yaas_session=%XX")).status, 401);
    db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO friendships (requester_id,addressee_id,status) VALUES (?,?,'accepted')").run(a.data.user.id,b.data.user.id);
    for(let i=0;i<105;i++)db.prepare("INSERT INTO direct_messages(id,sender_id,recipient_id,content,created_at) VALUES (?,?,?,?,?)").run(crypto.randomUUID(),b.data.user.id,a.data.user.id,'History '+i,new Date(Date.UTC(2020,0,1,0,0,i)).toISOString());
    const history=await req(`/api/dms/${b.data.user.id}`,a.cookie);
    assert.equal(history.data.messages.length,100); assert.equal(history.data.hasMore,true);
    const first=history.data.messages[0];
    const older=await req(`/api/dms/${b.data.user.id}?before=${encodeURIComponent(first.created_at)}&beforeId=${first.id}`,a.cookie);
    assert.equal(older.data.messages.length,5);
    assert.equal((await req(`/api/contacts/${b.data.user.id}`,a.cookie,{nickname:'My friend',pinned:true},'PATCH')).status,200);
    const inbox=await req('/api/dms',a.cookie);
    assert.equal(inbox.data.conversations[0].nickname,'My friend');
    assert.equal(Number(inbox.data.conversations[0].unread_count),105);
    assert.equal((await req('/api/dms',b.cookie)).data.conversations[0].nickname,null);
    await req(`/api/contacts/${b.data.user.id}`,a.cookie,{read:true},'PATCH');
    assert.equal(Number((await req('/api/dms',a.cookie)).data.conversations[0].unread_count),0);
    await req(`/api/friends/${b.data.user.id}`,a.cookie,undefined,'DELETE');
    assert.equal((await req(`/api/dms/${b.data.user.id}`,a.cookie)).status,200);
    assert.equal((await req(`/api/dms/${b.data.user.id}`,a.cookie,{content:'No longer friends'})).status,403);
    assert.equal((await req('/api/dms',a.cookie)).data.conversations.length,1);
    const serverId = crypto.randomUUID(), channelId = crypto.randomUUID();
    db.prepare("INSERT INTO servers (id,name,owner_id) VALUES (?,?,?)").run(serverId, "Private test", b.data.user.id);
    db.prepare("INSERT INTO memberships (server_id,user_id) VALUES (?,?)").run(serverId, a.data.user.id);
    db.prepare("INSERT INTO memberships (server_id,user_id) VALUES (?,?)").run(serverId, b.data.user.id);
    db.prepare("INSERT INTO channels (id,server_id,name,type,is_private) VALUES (?,?,?,'text',1)").run(channelId, serverId, "secret");
    assert.equal((await req(`/api/channels/${channelId}/messages`, a.cookie)).status, 404);
    assert.equal((await req(`/api/channels/${channelId}/messages`, a.cookie, { content: "attack" })).status, 404);
    assert.equal((await req(`/api/servers/${serverId}`, a.cookie, {}, "DELETE")).status, 403);
    db.prepare("UPDATE users SET is_site_owner=1 WHERE id=?").run(b.data.user.id);
    assert.equal((await req("/api/admin/security/summary", b.cookie)).status, 200);
    db.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE user_id=?").run(a.data.user.id);
    assert.equal((await req("/api/servers", a.cookie)).status, 401);
    for (let i = 0; i < 12; i++) assert.equal((await req("/api/auth/login", null, { email: "absent@example.com", password: "Wrong12345" })).status, 401);
    const limited = await req("/api/auth/login", null, { email: "absent@example.com", password: "Wrong12345" });
    assert.equal(limited.status, 429); assert.ok(limited.headers.get("retry-after"));
  } finally {
    db?.close();
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suffix, { force: true });
  }
});
