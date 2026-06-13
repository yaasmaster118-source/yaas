"use strict";

const ALL_PERMISSIONS = [
  "server.view", "server.manage", "members.view", "members.manage", "roles.manage",
  "channels.manage", "channel.view", "messages.send", "messages.manage", "voice.join",
  "voice.speak", "voice.mute_members", "invites.create"
];

const ROLE_TEMPLATES = [
  { name: "Owner", color: "#c9f34b", position: 100, permissions: ALL_PERMISSIONS },
  { name: "Admin", color: "#ef6d64", position: 80, permissions: ALL_PERMISSIONS.filter((item) => item !== "server.manage") },
  {
    name: "Moderator", color: "#8d7aff", position: 50,
    permissions: ["server.view", "members.view", "members.manage", "channel.view", "messages.send", "messages.manage", "voice.join", "voice.speak", "voice.mute_members", "invites.create"]
  },
  { name: "Member", color: "#8d949f", position: 10, permissions: ["server.view", "members.view", "channel.view", "messages.send", "voice.join", "voice.speak"] }
];

function validPermissions(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter((item) => ALL_PERMISSIONS.includes(item)))];
}

module.exports = { ALL_PERMISSIONS, ROLE_TEMPLATES, validPermissions };
