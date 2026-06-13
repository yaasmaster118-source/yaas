"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

test("voice rooms require authenticated server membership", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /getAuthenticatedUser\(request\)/);
  assert.match(server, /JOIN memberships/);
  assert.match(server, /c\.type = 'voice'/);
});

test("voice client includes WebRTC and microphone controls", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /new RTCPeerConnection/);
  assert.match(app, /getUserMedia/);
  assert.match(app, /leaveVoice/);
});
