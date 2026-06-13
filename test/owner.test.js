"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("owner credentials are read from environment variables", () => {
  const root = path.join(__dirname, "..");
  const files = ["schema.sql", "src/api.js", "src/auth.js", "scripts/create-owner.js", ".env.example"];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.match(source, /process\.env\.OWNER_EMAIL/);
  assert.match(source, /process\.env\.OWNER_PASSWORD/);
  assert.equal(/OWNER_PASSWORD\s*=\s*\S{8,}/.test(source), false);
});
