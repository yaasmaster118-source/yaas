"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { readSnapshot, importSnapshot, convert, secureConnection, TABLES } = require("../scripts/migrate-sqlite");
test("migration validates source integrity without changing the SQLite file", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "yaas-migrate-"));
  const filename = path.join(folder, "source.sqlite");
  try {
    const db = new DatabaseSync(filename);
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('account-1')");
    db.close();
    const before = fs.readFileSync(filename);
    assert.equal(readSnapshot(filename).users.length, 1);
    assert.deepEqual(fs.readFileSync(filename), before);
    const changed = new DatabaseSync(filename);
    changed.exec("CREATE TABLE unexpected(secret TEXT)"); changed.close();
    assert.throws(() => readSnapshot(filename), /UNKNOWN_TABLES/);
  } finally { fs.rmSync(folder, { recursive: true }); }
});
test("migration refuses a populated target and rolls back before inserting", async () => {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); return { rows: [{ count: 1 }] }; } };
  await assert.rejects(importSnapshot(client, Object.fromEntries(TABLES.map(table => [table, []]))), /TARGET_NOT_EMPTY/);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.some(sql => sql.startsWith("INSERT")), false);
  assert.equal(calls.includes("COMMIT"), false);
});
test("migration rejects data loss when row counts disagree", async () => {
  const calls = [];
  let counts = 0;
  const client = { query: async sql => {
    calls.push(sql);
    if (sql.startsWith("SELECT count")) { counts++; return { rows: [{ count: 0 }] }; }
    if (sql.includes("information_schema")) return { rows: [{ table_name: "users", column_name: "id", data_type: "uuid" }] };
    return { rows: [] };
  } };
  const snapshot = Object.fromEntries(TABLES.map(table => [table, []])); snapshot.users = [{ id: "example" }];
  await assert.rejects(importSnapshot(client, snapshot), /ROW_COUNT_MISMATCH/);
  assert.equal(counts, TABLES.length + 1);
  assert.equal(calls.at(-1), "ROLLBACK");
});
test("migration enforces TLS and preserves booleans, JSON and UTC timestamps", () => {
  const config = secureConnection("postgresql://user:password@example.neon.tech/db?sslmode=no-verify&sslrootcert=anything");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
  assert.equal(convert(0, "boolean"), false);
  assert.equal(convert(1, "boolean"), true);
  assert.throws(() => convert(2, "boolean"));
  assert.equal(convert('["role"]', "jsonb"), '["role"]');
  assert.equal(convert("2026-10-04 01:02:03", "timestamp with time zone"), "2026-10-04T01:02:03Z");
});
