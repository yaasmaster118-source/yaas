"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const TABLES = ["users", "sessions", "servers", "roles", "memberships", "member_roles", "channel_categories", "channels", "messages", "invites", "security_events", "admin_audit_logs", "oauth_accounts", "friendships", "direct_messages", "dm_attachments", "contact_preferences", "message_requests", "stream_sessions", "stream_viewers", "account_tokens", "user_blocks", "user_reports"];
function readSnapshot(filename, { allowEmpty = false } = {}) {
  const source = new DatabaseSync(filename, { readOnly: true });
  try {
    source.exec("BEGIN");
    if (source.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("SOURCE_INTEGRITY_FAILED");
    if (source.prepare("PRAGMA foreign_key_check").all().length) throw new Error("SOURCE_FOREIGN_KEYS_FAILED");
    const existing = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const unknown = [...existing].filter(name => !TABLES.includes(name) && !name.startsWith("sqlite_"));
    if (unknown.length) throw new Error("SOURCE_HAS_UNKNOWN_TABLES");
    const snapshot = {};
    for (const table of TABLES) snapshot[table] = existing.has(table) ? source.prepare(`SELECT * FROM "${table}"`).all() : [];
    if (!snapshot.users.length && !allowEmpty) throw new Error("SOURCE_HAS_NO_USERS");
    return snapshot;
  } finally { source.close(); }
}
function convert(value, type) {
  if (value == null) return null;
  if (type === "bytea") return Buffer.from(value);
  if (type === "boolean") {
    if (![0, 1, false, true].includes(value)) throw new Error("INVALID_BOOLEAN");
    return Boolean(value);
  }
  if (type === "jsonb") return JSON.stringify(typeof value === "string" ? JSON.parse(value) : value);
  if (type === "timestamp with time zone" && typeof value === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) return value.replace(" ", "T") + "Z";
  return value;
}
async function importSnapshot(client, snapshot) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SELECT pg_advisory_xact_lock(794112118)");
    await client.query(fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8"));
    await client.query(`LOCK TABLE ${TABLES.map(t => '"' + t + '"').join(",")} IN ACCESS EXCLUSIVE MODE`);
    for (const table of TABLES) {
      const result = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
      if (result.rows[0].count !== 0) throw new Error("TARGET_NOT_EMPTY");
    }
    const definitions = await client.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'");
    const counts = {};
    for (const table of TABLES) {
      const fields = new Map(definitions.rows.filter(row => row.table_name === table).map(row => [row.column_name, row.data_type]));
      for (const row of snapshot[table]) {
        const columns = Object.keys(row);
        if (columns.some(column => !fields.has(column))) throw new Error("SOURCE_HAS_UNKNOWN_COLUMNS");
        await client.query(`INSERT INTO "${table}" (${columns.map(column => '"' + column + '"').join(",")}) VALUES (${columns.map((_, index) => "$" + (index + 1)).join(",")})`, columns.map(column => convert(row[column], fields.get(column))));
      }
      const result = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
      if (result.rows[0].count !== snapshot[table].length) throw new Error("ROW_COUNT_MISMATCH");
      counts[table] = result.rows[0].count;
    }
    await client.query("COMMIT");
    return counts;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
function secureConnection(connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("INVALID_DATABASE_URL");
  // pg connection-string SSL flags can override the explicit TLS verification policy.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 30000 };
}
async function main() {
  if (!process.env.SQLITE_SOURCE_PATH || !process.env.DATABASE_URL) throw new Error("SOURCE_AND_DATABASE_URL_REQUIRED");
  const snapshot = readSnapshot(process.env.SQLITE_SOURCE_PATH);
  const { Client } = require("pg");
  const client = new Client(secureConnection(process.env.DATABASE_URL));
  try { await client.connect(); console.log(JSON.stringify({ migrated: await importSnapshot(client, snapshot) })); }
  finally { await client.end(); }
}
if (require.main === module) main().catch(error => { console.error("Migration failed:", /^[A-Z_]+$/.test(error.message) ? error.message : (error.code || "CHECK_SOURCE_AND_CONNECTION")); process.exitCode = 1; });
module.exports = { TABLES, readSnapshot, importSnapshot, convert, secureConnection };
