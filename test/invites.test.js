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

test("invite management and notification badges are wired", () => {
  const root = path.join(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  assert.match(api, /\/api\/notifications\/summary/);
  assert.match(api, /creator_name/);
  assert.match(api, /DELETE FROM invites/);
  assert.match(app, /renderServerInvites/);
  assert.match(app, /loadNotificationSummary/);
  assert.match(html, /id="settings-invite-list"/);
  assert.match(html, /id="mobile-friends-button"/);
  assert.match(css, /\.notification-badge/);
  assert.match(css, /\.invite-list-row/);
});
