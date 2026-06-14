"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

test("server deletion is owner-only and friends can use direct messages", () => {
  const root = path.join(__dirname, "..");
  const schema = fs.readFileSync(path.join(root, "schema.sql"), "utf8");
  const database = fs.readFileSync(path.join(root, "src", "database.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS friendships/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS direct_messages/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS friendships/);
  assert.match(api, /Yalnızca sunucu sahibi sunucuyu silebilir/);
  assert.match(api, /Özel mesaj için önce arkadaş olmalısınız/);
  assert.match(app, /delete-server-button/);
  assert.match(app, /friend-request-form/);
  assert.match(app, /dm-message-form/);
});
