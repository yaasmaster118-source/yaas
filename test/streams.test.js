"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const { ALL_PERMISSIONS, ROLE_TEMPLATES } = require("../src/permissions");

test("stream permission and streamer role are available", () => {
  assert.equal(ALL_PERMISSIONS.includes("streams.create"), true);
  const streamer = ROLE_TEMPLATES.find((role) => role.name === "Yayinci");
  assert.ok(streamer);
  assert.equal(streamer.permissions.includes("streams.create"), true);
});

test("stream sessions are stored in hosted and local databases", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  const database = fs.readFileSync(path.join(__dirname, "..", "src", "database.js"), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS stream_sessions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS stream_viewers/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS stream_sessions/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS stream_viewers/);
  assert.match(schema, /visibility TEXT NOT NULL DEFAULT 'server'/);
  assert.match(database, /stream_sessions_status_idx/);
  assert.match(database, /stream_viewers_stream_idx/);
});

test("stream API and home UI are wired together", () => {
  const api = fs.readFileSync(path.join(__dirname, "..", "src", "api.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(api, /\/api\/streams/);
  assert.match(api, /\/viewers/);
  assert.match(api, /streams\.create/);
  assert.match(server, /streamRooms/);
  assert.match(server, /\/api\/stream-rtc\/join/);
  assert.match(server, /\/api\/stream-rtc\/signal/);
  assert.match(app, /function renderStreams/);
  assert.match(app, /function renderStreamViewer/);
  assert.match(app, /async function openStreamViewer/);
  assert.match(app, /async function startStreamBroadcast/);
  assert.match(app, /getDisplayMedia/);
  assert.match(app, /id="stream-remote-video"/);
  assert.match(app, /async function startStream/);
  assert.match(app, /\[data-stream-tab\]/);
  assert.match(html, /data-stream-tab="global"/);
  assert.match(html, /id="stream-grid"/);
  assert.match(html, /id="server-stream-list"/);
});
