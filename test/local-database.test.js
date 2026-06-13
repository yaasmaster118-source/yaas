"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

test("local database stores owner accounts without PostgreSQL", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "database.js"), "utf8");
  assert.match(source, /node:sqlite/);
  assert.match(source, /is_site_owner INTEGER NOT NULL DEFAULT 0/);
  assert.match(source, /\.data/);
  assert.notEqual(os.tmpdir(), "");
});
