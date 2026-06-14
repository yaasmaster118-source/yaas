"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

test("invite links open the app and join after authentication", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");

  assert.match(server, /pathname === "\/" \|\| \/\^\\\/invite\\\//);
  assert.match(app, /joinPendingInvite/);
  assert.match(app, /yaasPendingInvite/);
  assert.match(app, /history\.replaceState/);
  assert.match(api, /existingMembership/);
});
