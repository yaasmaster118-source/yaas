"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

test("server has baseline production security protections", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const auth = fs.readFileSync(path.join(root, "src", "auth.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");
  const security = fs.readFileSync(path.join(root, "src", "security.js"), "utf8");

  assert.match(server, /applyRateLimit/);
  assert.match(security, /POLICIES/);
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /Permissions-Policy/);
  assert.match(server, /Cross-Origin-Opener-Policy/);
  assert.match(server, /MAX_JSON_BYTES/);
  assert.match(server, /safeDecodePath/);
  assert.match(server, /requestTimeout/);
  assert.match(auth, /Priority=High/);
  assert.match(api, /E-posta veya sifre hatali/);
  assert.match(api, /error\.statusCode === 413/);
  assert.match(server, /Strict-Transport-Security/);
  assert.match(server, /X-Frame-Options", "DENY/);
  assert.match(security, /SECURITY_ALERT_WEBHOOK_URL/);
  assert.match(api, /\/api\/admin\/security\/summary/);
});

test("security policies separate sensitive actions and validate image signatures", () => {
  const { consumeRateLimit, clientIp, redactMetadata, requestPolicy, validateImageValue } = require("../src/security");
  const request = (method, url) => ({ method, url, headers: {}, socket: { remoteAddress: "127.0.0.1" } });
  assert.equal(requestPolicy(request("POST", "/api/auth/login")), "auth");
  assert.equal(requestPolicy(request("POST", "/api/auth/register")), "register");
  assert.equal(requestPolicy(request("POST", "/api/friends/requests")), "social");
  assert.equal(requestPolicy(request("POST", "/api/channels/abc/messages")), "messages");
  assert.equal(validateImageValue("http://insecure.example/avatar.png"), null);
  assert.equal(validateImageValue("data:image/png;base64,ZmFrZQ=="), null);
  const png = Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64");
  assert.match(validateImageValue(`data:image/png;base64,${png}`), /^data:image\/png/);
  const oversized = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(512000)]).toString("base64");
  assert.equal(validateImageValue(`data:image/png;base64,${oversized}`), null);
  assert.deepEqual(redactMetadata({ password: "hidden", nested: { token: "hidden", attempts: 3 } }), { nested: { attempts: 3 } });
  const originalCloudflare = process.env.TRUST_CLOUDFLARE;
  delete process.env.TRUST_CLOUDFLARE;
  assert.notEqual(clientIp({ headers: { "cf-connecting-ip": "spoofed" }, socket: { remoteAddress: "127.0.0.1" } }), "spoofed");
  if (originalCloudflare !== undefined) process.env.TRUST_CLOUDFLARE = originalCloudflare;
  for (let i = 0; i < 12; i++) assert.equal(consumeRateLimit("test-auth", "auth", 1000).allowed, true);
  assert.equal(consumeRateLimit("test-auth", "auth", 1000).allowed, false);
  assert.equal(consumeRateLimit("test-auth", "auth", 61001).allowed, true);
});

test("configured email alerts use recipient, omit metadata secrets and suppress immediate duplicates", async () => {
  const { queueAlert } = require("../src/security");
  const oldFetch = global.fetch;
  const names = ["RESEND_API_KEY", "SECURITY_ALERT_FROM", "SECURITY_ALERT_EMAIL", "SECURITY_ALERT_WEBHOOK_URL"];
  const oldEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const calls = [];
  try {
    process.env.RESEND_API_KEY = "unit-test-placeholder";
    process.env.SECURITY_ALERT_FROM = "security@example.com";
    process.env.SECURITY_ALERT_EMAIL = "owner@example.com";
    delete process.env.SECURITY_ALERT_WEBHOOK_URL;
    global.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true }; };
    queueAlert("test-only-alert", "high", { secret: "must-not-send" });
    queueAlert("test-only-alert", "high", {});
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.deepEqual(calls[0].body.to, ["owner@example.com"]);
    assert.equal(JSON.stringify(calls).includes("must-not-send"), false);
  } finally {
    global.fetch = oldFetch;
    for (const name of names) { if (oldEnv[name] === undefined) delete process.env[name]; else process.env[name] = oldEnv[name]; }
  }
});

test("security schema and admin routes are server-side protected", () => {
  const root = path.join(__dirname, "..");
  const schema = fs.readFileSync(path.join(root, "schema.sql"), "utf8");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS security_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS admin_audit_logs/);
  assert.match(api, /if \(!user\.is_site_owner\)/);
  assert.match(api, /admin_access_denied/);
});
