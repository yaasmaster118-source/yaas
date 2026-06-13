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

test("Google and Apple login stay disabled until credentials are configured", () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.APPLE_CLIENT_ID;
  delete process.env.APPLE_CLIENT_SECRET;
  const { publicProviders } = require("../src/oauth");
  assert.deepEqual(publicProviders(), { google: false, apple: false });
});
