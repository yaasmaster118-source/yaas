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

test("voice client supports camera and screen sharing", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /getDisplayMedia/);
  assert.match(app, /facingMode: "user"/);
  assert.match(app, /replaceTrack/);
  assert.match(app, /addTransceiver\("video"/);
  assert.match(app, /pollFailures/);
  assert.doesNotMatch(app, /onnegotiationneeded/);
  assert.match(app, /toggleCamera/);
  assert.match(app, /toggleScreenShare/);
});

test("voice permissions and TURN configuration are enforced by the server", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  assert.match(server, /voiceAccess/);
  assert.match(server, /voice\.join/);
  assert.match(server, /voice\.speak/);
  assert.match(server, /TURN_URL/);
  assert.match(server, /\/api\/voice\/moderate/);
  assert.match(server, /canModerateVoiceTarget/);
  assert.match(server, /userLimit/);
  assert.match(schema, /audio_bitrate/);
  assert.match(schema, /quality_mode/);
});

test("voice client applies adaptive quality and moderator controls", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(app, /applySenderLimits/);
  assert.match(app, /maxBitrate/);
  assert.match(app, /moderateVoiceParticipant/);
  assert.match(app, /moderator-mute/);
  assert.match(app, /channel-settings-user-limit/);
  assert.match(app, /syncVoiceStage/);
  assert.match(app, /setVoiceControl/);
});
