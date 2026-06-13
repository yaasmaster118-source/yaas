"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ALL_PERMISSIONS, ROLE_TEMPLATES, validPermissions } = require("../src/permissions");

test("owner has every permission", () => {
  const owner = ROLE_TEMPLATES.find((role) => role.name === "Owner");
  assert.deepEqual(owner.permissions, ALL_PERMISSIONS);
});

test("member cannot manage a server", () => {
  const member = ROLE_TEMPLATES.find((role) => role.name === "Member");
  assert.equal(member.permissions.includes("server.manage"), false);
  assert.equal(member.permissions.includes("roles.manage"), false);
  assert.equal(member.permissions.includes("channel.view"), true);
  assert.equal(member.permissions.includes("messages.send"), true);
});

test("custom permissions reject unknown values and duplicates", () => {
  assert.deepEqual(
    validPermissions(["channel.view", "unknown.permission", "channel.view", "voice.join"]),
    ["channel.view", "voice.join"]
  );
});
