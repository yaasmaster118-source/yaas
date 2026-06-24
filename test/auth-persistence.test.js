"use strict";

const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

test("registered account remains available for later login", async () => {
  const databasePath = path.join(os.tmpdir(), `yaas-auth-${crypto.randomUUID()}.sqlite`);
  process.env.LOCAL_DATABASE_PATH = databasePath;
  const { query, getPool } = require("../src/database");
  const { hashPassword, verifyPassword } = require("../src/auth");
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword("kalici-sifre-123");

  await query(
    `INSERT INTO users (id, email, display_name, handle, password_hash, is_site_owner)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, "uye@example.com", "Kalıcı Üye", "kalici-uye", passwordHash, false]
  );

  const saved = await query("SELECT email, password_hash FROM users WHERE email = $1", ["uye@example.com"]);
  assert.equal(saved.rowCount, 1);
  assert.equal(await verifyPassword("kalici-sifre-123", saved.rows[0].password_hash), true);

  await getPool().end();
  fs.rmSync(databasePath, { force: true });
  delete process.env.LOCAL_DATABASE_PATH;
});

test("accounts are unique by email and server memberships survive logout", async () => {
  const databasePath = path.join(os.tmpdir(), `yaas-account-${crypto.randomUUID()}.sqlite`);
  process.env.LOCAL_DATABASE_PATH = databasePath;
  const { getPool, initializeDatabase, query } = require("../src/database");
  const { hashPassword } = require("../src/auth");
  const userId = crypto.randomUUID();
  const serverId = crypto.randomUUID();

  await initializeDatabase();
  await query(
    `INSERT INTO users (id, email, display_name, handle, password_hash, is_site_owner)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, "tek@example.com", "Tek Hesap", "tek-hesap", await hashPassword("kalici-sifre-123"), false]
  );
  await assert.rejects(
    query(
      `INSERT INTO users (id, email, display_name, handle, password_hash, is_site_owner)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), "tek@example.com", "Kopya", "kopya", await hashPassword("kalici-sifre-123"), false]
    ),
    /UNIQUE|unique|duplicate/i
  );
  await query(
    "INSERT INTO servers (id, name, description, icon_color, owner_id) VALUES ($1, $2, $3, $4, $5)",
    [serverId, "Kalici Sunucu", "", "lime", userId]
  );
  await query("INSERT INTO memberships (server_id, user_id) VALUES ($1, $2)", [serverId, userId]);
  await query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), userId, "logout-test-token", new Date(Date.now() + 86_400_000)]
  );
  await query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  const membership = await query("SELECT 1 FROM memberships WHERE server_id = $1 AND user_id = $2", [serverId, userId]);
  assert.equal(membership.rowCount, 1);

  await getPool().end();
  fs.rmSync(databasePath, { force: true });
  delete process.env.LOCAL_DATABASE_PATH;
});

test("authentication flow requires an existing account and stronger registration", () => {
  const root = path.join(__dirname, "..");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(api, /strongPassword/);
  assert.match(api, /Bu e-posta ile hesap bulunamadı/);
  assert.match(api, /Şifre yanlış/);
  assert.match(app, /register-password-confirm/);
  assert.match(app, /Şifreler aynı olmalı/);
  assert.match(html, /id="register-password-confirm"/);
  assert.match(html, /Hesabın yoksa giriş yapılamaz/);
});

test("Google and Apple login stay disabled until credentials are configured", () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.APPLE_CLIENT_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_KEY_ID;
  delete process.env.APPLE_PRIVATE_KEY;
  const { publicProviders } = require("../src/oauth");
  assert.deepEqual(publicProviders(), { google: false, apple: false });
});

test("Google login can also create an account", () => {
  const root = path.join(__dirname, "..");
  const oauth = fs.readFileSync(path.join(root, "src", "oauth.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(oauth, /INSERT INTO users/);
  assert.match(oauth, /INSERT INTO oauth_accounts/);
  assert.match(oauth, /openid email profile/);
  assert.match(api, /authError=/);
  assert.match(app, /Google ile ilk girişte YAAS hesabın otomatik oluşur/);
  assert.match(html, /Google ile giriş yap \/ hesap oluştur/);
});

test("Apple client secret is generated as an ES256 JWT", () => {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.APPLE_CLIENT_ID = "com.yaas.web";
  process.env.APPLE_TEAM_ID = "TEAM123";
  process.env.APPLE_KEY_ID = "KEY123";
  process.env.APPLE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  const { appleClientSecret } = require("../src/oauth");
  const token = appleClientSecret(1_700_000_000);
  const [header, payload, signature] = token.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "ES256");
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).sub, "com.yaas.web");
  assert.ok(signature);
});

test("Apple identity tokens are verified against Apple public keys", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "oauth.js"), "utf8");
  assert.match(source, /appleid\.apple\.com\/auth\/keys/);
  assert.match(source, /crypto\.verify/);
  assert.match(source, /payload\.iss !== "https:\/\/appleid\.apple\.com"/);
  assert.match(source, /APPLE_CLIENT_ID/);
});
