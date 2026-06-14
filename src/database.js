"use strict";

const fs = require("fs");
const path = require("path");

let pool;
let localDatabase;

function getLocalDatabase() {
  if (localDatabase) return localDatabase;

  const { DatabaseSync } = require("node:sqlite");
  const configuredPath = process.env.LOCAL_DATABASE_PATH;
  const dataDirectory = configuredPath ? path.dirname(configuredPath) : path.join(__dirname, "..", ".data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  localDatabase = new DatabaseSync(configuredPath || path.join(dataDirectory, "yaas.sqlite"));
  localDatabase.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      handle TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_site_owner INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon_color TEXT NOT NULL DEFAULT 'lime',
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#c9f34b',
      position INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '[]',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, name)
    );
    CREATE TABLE IF NOT EXISTS memberships (
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(server_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS member_roles (
      server_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY(server_id, user_id, role_id),
      FOREIGN KEY(server_id, user_id) REFERENCES memberships(server_id, user_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('text', 'voice')),
      position INTEGER NOT NULL DEFAULT 0,
      is_private INTEGER NOT NULL DEFAULT 0,
      allowed_role_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(server_id, name, type)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at TEXT
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT,
      max_uses INTEGER,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider, provider_user_id)
    );
    CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
    CREATE INDEX IF NOT EXISTS channels_server_idx ON channels(server_id, position);
    CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages(channel_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS member_roles_member_idx ON member_roles(server_id, user_id);
    CREATE INDEX IF NOT EXISTS oauth_accounts_user_idx ON oauth_accounts(user_id);
  `);
  return localDatabase;
}

function toSqliteQuery(text, values) {
  const orderedValues = [];
  const sql = text
    .replace(/\$(\d+)/g, (_, index) => {
      orderedValues.push(values[Number(index) - 1]);
      return "?";
    })
    .replace(/::(?:int|jsonb)\b/gi, "")
    .replace(/\s+FOR\s+UPDATE\b/gi, "")
    .replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP");
  return {
    sql,
    values: orderedValues.map((value) => {
      if (value instanceof Date) return value.toISOString();
      if (typeof value === "boolean") return value ? 1 : 0;
      return value;
    })
  };
}

function localQuery(text, values = []) {
  const database = getLocalDatabase();
  const prepared = toSqliteQuery(text, values);
  const statement = database.prepare(prepared.sql);
  const isSelect = /^\s*(SELECT|WITH|PRAGMA)\b/i.test(prepared.sql);
  if (isSelect) {
    const rows = statement.all(...prepared.values);
    return Promise.resolve({ rows, rowCount: rows.length });
  }
  const result = statement.run(...prepared.values);
  return Promise.resolve({ rows: [], rowCount: Number(result.changes) });
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    return {
      query: localQuery,
      end: async () => {
        if (localDatabase) {
          localDatabase.close();
          localDatabase = undefined;
        }
      }
    };
  }

  if (!pool) {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000
    });
  }
  return pool;
}

async function query(text, values = []) {
  return getPool().query(text, values);
}

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    getLocalDatabase();
    return;
  }
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await getPool().query(schema);
}

async function transaction(callback) {
  if (!process.env.DATABASE_URL) {
    const database = getLocalDatabase();
    database.exec("BEGIN");
    try {
      const result = await callback({ query: localQuery });
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { getPool, initializeDatabase, query, transaction };
