"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

test("server has baseline production security protections", () => {
  const root = path.join(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const auth = fs.readFileSync(path.join(root, "src", "auth.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "src", "api.js"), "utf8");

  assert.match(server, /applyRateLimit/);
  assert.match(server, /RATE_LIMITS/);
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /Permissions-Policy/);
  assert.match(server, /Cross-Origin-Opener-Policy/);
  assert.match(server, /MAX_JSON_BYTES/);
  assert.match(server, /safeDecodePath/);
  assert.match(server, /requestTimeout/);
  assert.match(auth, /Priority=High/);
  assert.match(api, /E-posta veya sifre hatali/);
  assert.match(api, /error\.statusCode === 413/);
});
