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

test("Studio requires an audience choice and ignores a hidden server for public broadcasts", () => {
  const {sandbox}=windowHarness();
  const values={"#studio-broadcast-title":"Audience test","#studio-visibility":"","#studio-server":"private-server"};
  const studio={host:{querySelector(selector){return {value:values[selector]};}}};
  const settings=()=>sandbox.YaasStudio.prototype.broadcastSettings.call(studio);
  assert.throws(settings,/kimlerin/);
  values["#studio-visibility"]="server";assert.equal(settings().serverId,"private-server");
  values["#studio-visibility"]="global";assert.equal(settings().serverId,null);assert.equal(settings().visibility,"global");
});

test("ending a broadcast releases composed tracks even when the server cannot be reached", async () => {
  let stopped = 0;
  const { sandbox, studio, state } = windowHarness({
    api: async () => { throw new Error("offline"); }
  });
  state.activeStream = { id: "created" };
  studio.output = { getTracks: () => [{ stop() { stopped++; } }, { stop() { stopped++; } }] };
  studio.live = true;
  studio.sync = () => {};
  studio.host = { querySelector: () => ({ textContent: "" }) };
  await sandbox.stopStandaloneBroadcast();
  assert.equal(stopped, 2);
  assert.equal(studio.output, null);
  assert.equal(studio.live, false);
  assert.equal(state.activeStream, null);
  await sandbox.stopStandaloneBroadcast();
  assert.equal(stopped, 2);
});
