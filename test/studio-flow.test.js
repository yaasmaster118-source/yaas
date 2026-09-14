"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function windowHarness(overrides = {}) {
  const requests = [];
  const state = { activeStream: null };
  const studio = { closed: false, broadcastSettings: () => ({ title: "Test", visibility: "global", serverId: null }), addEvent() {}, setSettingsEnabled() {} };
  const sandbox = {
    YaasStudio: function() {}, URL, URLSearchParams, location: { href: "http://localhost/?v=1" }, UI_VERSION: "test", studioWindowRef: null,
    window: { open: () => ({ location: { href: "about:blank", replace() {} }, focus() {} }) },
    document: { title: "" }, state, activeStudio: studio,
    api: async (url, options) => { requests.push({ url, method: options?.method }); return { stream: { id: "created", user_id: "owner" } }; },
    joinStreamRtc: async () => {}, setStreamBroadcastMedia: async () => {}, leaveStreamRtc: async () => {}, notify() {},
    ...overrides
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../studio-window.js"), "utf8"), sandbox);
  return { sandbox, requests, state, studio };
}
test("opening Studio creates no live session; only explicit start creates it", async () => {
  const { sandbox, requests, state } = windowHarness();
  sandbox.openStudioWindow();
  assert.equal(requests.length, 0);
  assert.equal(state.activeStream, null);
  await sandbox.startStandaloneBroadcast({});
  assert.deepEqual(requests, [{ url: "/api/streams", method: "POST" }]);
  assert.equal(state.activeStream.id, "created");
});
test("failed media setup rolls back the public live session", async () => {
  const { sandbox, requests, state } = windowHarness({ setStreamBroadcastMedia: async () => { throw new Error("media failed"); } });
  await assert.rejects(sandbox.startStandaloneBroadcast({}), /media failed/);
  assert.ok(requests.some(request => request.url === "/api/streams/created" && request.method === "DELETE"));
  assert.equal(state.activeStream, null);
});
test("reopening a named Studio does not reload or interrupt its broadcast", () => {
  let replacements = 0;
  const { sandbox } = windowHarness({ window: { open: () => ({ location: { href: "http://localhost/?studio=1", replace() { replacements++; } }, focus() {} }) } });
  sandbox.openStudioWindow();
  assert.equal(replacements, 0);
});
