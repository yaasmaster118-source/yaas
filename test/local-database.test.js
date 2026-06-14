"use strict";

const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

test("local database supports complete server creation", async () => {
  const databasePath = path.join(os.tmpdir(), `yaas-server-${crypto.randomUUID()}.sqlite`);
  process.env.LOCAL_DATABASE_PATH = databasePath;
  const { getPool, initializeDatabase, query, transaction } = require("../src/database");
  const userId = crypto.randomUUID();
  const serverId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const textChannelId = crypto.randomUUID();
  const voiceChannelId = crypto.randomUUID();

  await initializeDatabase();
  await query(
    `INSERT INTO users (id, email, display_name, handle, password_hash, is_site_owner)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, "owner@example.com", "Owner", "owner", "hash", true]
  );
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO servers (id, name, description, icon_color, owner_id) VALUES ($1, $2, $3, $4, $5)",
      [serverId, "Test Server", "", "lime", userId]
    );
    await client.query("INSERT INTO memberships (server_id, user_id) VALUES ($1, $2)", [serverId, userId]);
    await client.query(
      `INSERT INTO roles (id, server_id, name, color, position, permissions, is_system)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, TRUE)`,
      [roleId, serverId, "Owner", "#c9f34b", 100, JSON.stringify(["server.manage"])]
    );
    await client.query(
      "INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)",
      [serverId, userId, roleId]
    );
    await client.query(
      `INSERT INTO channels (id, server_id, name, type, position)
       VALUES ($1, $2, 'genel', 'text', 10), ($3, $2, 'Ses Odasi', 'voice', 20)`,
      [textChannelId, serverId, voiceChannelId]
    );
  });

  const roles = await query("SELECT permissions FROM roles WHERE server_id = $1", [serverId]);
  const channels = await query("SELECT id FROM channels WHERE server_id = $1 ORDER BY position", [serverId]);
  assert.deepEqual(JSON.parse(roles.rows[0].permissions), ["server.manage"]);
  assert.equal(channels.rowCount, 2);

  await query(
    "INSERT INTO invites (id, server_id, code, created_by) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), serverId, "test-code", userId]
  );
  const invite = await query("SELECT * FROM invites WHERE code = $1 FOR UPDATE", ["test-code"]);
  assert.equal(invite.rowCount, 1);

  process.env.OWNER_EMAIL = "owner@example.com";
  await initializeDatabase();
  const owner = await query("SELECT is_site_owner FROM users WHERE email = $1", ["owner@example.com"]);
  assert.equal(owner.rows[0].is_site_owner, 1);

  await getPool().end();
  fs.rmSync(databasePath, { force: true });
  delete process.env.LOCAL_DATABASE_PATH;
  delete process.env.OWNER_EMAIL;
});
