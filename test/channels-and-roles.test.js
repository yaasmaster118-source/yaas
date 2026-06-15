"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

test("channels support categories and roles enforce hierarchy", () => {
  const root = path.join(__dirname, "..");
  const schema = fs.readFileSync(path.join(root, "schema.sql"), "utf8");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS channel_categories/);
  assert.match(schema, /category_id UUID/);
  assert.match(api, /highestRolePosition/);
  assert.match(api, /Kendi rolüne eşit veya yüksek bir rolü yönetemezsin/);
  assert.match(api, /Bu rolü veremezsin/);
  assert.match(app, /channel-category-input/);
  assert.match(app, /category-form/);
  assert.doesNotMatch(app, /event\.currentTarget\.reset\(\)/);
  assert.match(api, /SERVER_TEMPLATES/);
  assert.match(api, /leaveServerRoute/);
  assert.match(html, /data-server-template="gaming"/);
  assert.match(html, /data-settings-panel="overview"/);
});
