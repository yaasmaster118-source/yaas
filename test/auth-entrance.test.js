"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loginHarness(api) {
  let handler;
  const order = [];
  const button = { disabled: false };
  const form = { dataset: {}, reset() {}, querySelector: () => button, addEventListener: (_, fn) => { handler = fn; } };
  const elements = { "#login-form": form, "#login-email": { value: "test@example.com" }, "#login-password": { value: "test-only" }, "#login-error": { textContent: "" } };
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const start = source.indexOf('$("#login-form").addEventListener("submit"');
  const end = source.indexOf('$("#register-form").addEventListener("submit"', start);
  vm.runInNewContext(source.slice(start, end), {
    $: selector => elements[selector], api,
    window: { yaasEntrance: { async enter(reveal) { order.push("transition"); reveal(); } } },
    showApp() { order.push("app"); }, isStudioWindow: false,
    loadNotificationSummary: async () => {}, joinPendingInvite: async () => false,
    loadServers: async () => {}, loadStreams: async () => {}
  });
  return { run: () => handler({ preventDefault() {}, currentTarget: form }), order, button, elements };
}
test("failed authentication stays on the form without entering animation", async () => {
  const h = loginHarness(async () => { throw new Error("Şifre yanlış"); });
  await h.run();
  assert.deepEqual(h.order, []);
  assert.equal(h.elements["#login-error"].textContent, "Şifre yanlış");
  assert.equal(h.button.disabled, false);
});
test("successful authentication runs entrance before revealing the app", async () => {
  const h = loginHarness(async () => ({ user: { id: "test" } }));
  await h.run();
  assert.deepEqual(h.order, ["transition", "app"]);
  assert.equal(h.button.disabled, false);
});
test("repeated submit during authentication sends only one request", async () => {
  let calls = 0, resolve;
  const h = loginHarness(() => { calls++; return new Promise(done => { resolve = done; }); });
  const pending = h.run();
  await h.run();
  assert.equal(calls, 1);
  assert.equal(h.button.disabled, true);
  resolve({ user: {} }); await pending;
  assert.equal(h.button.disabled, false);
});
