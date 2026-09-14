"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

test("Studio chat enforces audience access and main-window viewing preserves broadcaster", { timeout: 30000 }, async () => {
  const db = path.join(os.tmpdir(), `yaas-studio-${crypto.randomUUID()}.sqlite`);
  const server = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: "4186", DATABASE_URL: "", LOCAL_DATABASE_PATH: db }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Test server timeout")), 15000);
      server.stdout.on("data", data => { if (String(data).includes("YAAS is running")) { clearTimeout(timer); resolve(); } });
      server.once("exit", code => { clearTimeout(timer); reject(new Error(`Test server exited ${code}`)); });
      server.once("error", reject);
    });
    async function request(route, cookie, body, method = body ? "POST" : "GET") {
      const response = await fetch(`http://localhost:4186${route}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
    }
    const owner = await request("/api/auth/register", null, { name: "Studio Test", email: "studio@example.com", password: "Studio-test-9876" });
    const viewer = await request("/api/auth/register", null, { name: "Viewer Test", email: "viewer@example.com", password: "Studio-test-9876" });
    assert.ok(owner.cookie); assert.ok(viewer.cookie);
    const created = await request("/api/streams", owner.cookie, { title: "Studio test", visibility: "global" });
    const streamId = created.data.stream.id;
    assert.equal((await request("/api/stream-rtc/join", owner.cookie, { streamId, clientId: "studio", role: "broadcaster" })).status, 200);
    assert.equal((await request("/api/stream-rtc/join", owner.cookie, { streamId, clientId: "main-window", role: "viewer" })).status, 200);
    const poll = () => request(`/api/stream-rtc/poll?streamId=${streamId}&clientId=studio`, owner.cookie);
    assert.equal((await poll()).status, 200);
    assert.equal((await request("/api/stream-rtc/chat", viewer.cookie, { streamId, text: "Merhaba yayın!" })).status, 201);
    assert.equal((await poll()).data.messages[0].text, "Merhaba yayın!");
    assert.equal((await request("/api/stream-rtc/chat", viewer.cookie, { streamId, text: "Flood" })).status, 429);
    await request("/api/stream-rtc/leave", owner.cookie, { streamId, clientId: "main-window" });
    assert.equal((await poll()).status, 200);
    const privateStream = await request("/api/streams", owner.cookie, { title: "Private", visibility: "friends" });
    assert.equal((await request("/api/stream-rtc/chat", viewer.cookie, { streamId: privateStream.data.stream.id, text: "No access" })).status, 403);
    await request(`/api/streams/${streamId}`, owner.cookie, null, "DELETE");
    assert.equal((await request("/api/stream-rtc/chat", viewer.cookie, { streamId, text: "After end" })).status, 403);
  } finally {
    if (server.exitCode === null) { const exit = once(server, "exit"); server.kill(); await exit; }
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(db + suffix, { force: true });
  }
});
