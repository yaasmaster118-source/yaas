const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleApi } = require("./src/api");
const { getAuthenticatedUser } = require("./src/auth");
const { initializeDatabase, query } = require("./src/database");

const port = Number(process.env.PORT) || 4173;
const root = __dirname;
const voiceRooms = new Map();
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ico": "image/x-icon"
};

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/api/") && !request.url.startsWith("/api/voice/")) {
    const isAppleCallback = request.url.startsWith("/api/auth/oauth/apple/callback");
    if (!isAppleCallback && !isSameOrigin(request)) {
      sendJson(response, 403, { error: "Geçersiz istek kaynağı" });
      return;
    }
    handleApi(request, response, { getOrigin, readForm, readJson, sendJson });
    return;
  }

  if (request.url === "/robots.txt") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`User-agent: *\nAllow: /\nSitemap: ${getOrigin(request)}/sitemap.xml\n`);
    return;
  }

  if (request.url === "/sitemap.xml") {
    response.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    response.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${getOrigin(request)}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>`);
    return;
  }

  if (request.url.startsWith("/api/voice/")) {
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { error: "Geçersiz istek kaynağı" });
      return;
    }
    handleVoiceApi(request, response);
    return;
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      status: "ok",
      version: "1.1.0-dev",
      build: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "local"
    }));
    return;
  }

  const pathname = request.url.split("?")[0];
  const requestPath = pathname === "/" || /^\/invite\/[A-Za-z0-9_-]+$/.test(pathname)
    ? "/index.html"
    : pathname;
  const filePath = path.resolve(root, `.${decodeURIComponent(requestPath)}`);
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": [".html", ".css", ".js", ".webmanifest"].includes(path.extname(filePath))
        ? "no-cache"
        : "public, max-age=3600"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
});

function getOrigin(request) {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host || `localhost:${port}`;
  return `${protocol}://${host}`;
}

function isSameOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.origin;
  return !origin || origin === getOrigin(request);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function readForm(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(Object.fromEntries(new URLSearchParams(body)));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

function cleanVoiceRooms() {
  const cutoff = Date.now() - 300_000;
  for (const [roomId, room] of voiceRooms) {
    for (const [clientId, client] of room) {
      if (client.lastSeen < cutoff) room.delete(clientId);
    }
    if (room.size === 0) voiceRooms.delete(roomId);
  }
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function voiceAccess(channelId, userId) {
  const channelResult = await query(
    `SELECT c.id, c.server_id, c.type, c.is_private, c.allowed_role_ids,
            c.user_limit, c.audio_bitrate, c.quality_mode, s.owner_id
       FROM channels c JOIN servers s ON s.id = c.server_id
       JOIN memberships m ON m.server_id = c.server_id
      WHERE c.id = $1 AND c.type = 'voice' AND m.user_id = $2`,
    [channelId, userId]
  );
  const channel = channelResult.rows[0];
  if (!channel) return null;
  if (channel.owner_id === userId) {
    return {
      join: true,
      speak: true,
      moderate: true,
      userLimit: Number(channel.user_limit) || 0,
      audioBitrate: Number(channel.audio_bitrate) || 64,
      qualityMode: channel.quality_mode || "auto"
    };
  }
  const roles = await query(
    `SELECT r.id, r.permissions FROM member_roles mr
      JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = $1 AND mr.user_id = $2`,
    [channel.server_id, userId]
  );
  const roleIds = new Set(roles.rows.map((role) => role.id));
  if (channel.is_private && !arrayValue(channel.allowed_role_ids).some((roleId) => roleIds.has(roleId))) {
    return null;
  }
  const permissions = new Set(roles.rows.flatMap((role) => arrayValue(role.permissions)));
  return {
    join: permissions.has("voice.join"),
    speak: permissions.has("voice.speak"),
    moderate: permissions.has("voice.mute_members"),
    userLimit: Number(channel.user_limit) || 0,
    audioBitrate: Number(channel.audio_bitrate) || 64,
    qualityMode: channel.quality_mode || "auto"
  };
}

async function canModerateVoiceTarget(serverId, actorUserId, targetUserId) {
  const server = await query("SELECT owner_id FROM servers WHERE id = $1", [serverId]);
  const ownerId = server.rows[0]?.owner_id;
  if (!ownerId || targetUserId === ownerId) return false;
  if (actorUserId === ownerId) return true;
  const positions = await query(
    `SELECT mr.user_id, MAX(r.position) AS position
       FROM member_roles mr JOIN roles r ON r.id = mr.role_id
      WHERE mr.server_id = $1 AND mr.user_id IN ($2, $3)
      GROUP BY mr.user_id`,
    [serverId, actorUserId, targetUserId]
  );
  const byUser = new Map(positions.rows.map((row) => [row.user_id, Number(row.position) || 0]));
  return (byUser.get(actorUserId) || 0) > (byUser.get(targetUserId) || 0);
}

async function handleVoiceApi(request, response) {
  cleanVoiceRooms();
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/voice/config") {
      const user = await getAuthenticatedUser(request);
      if (!user) return sendJson(response, 401, { error: "Oturum gerekli" });
      const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
      if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
        iceServers.push({
          urls: process.env.TURN_URL.split(",").map((item) => item.trim()).filter(Boolean),
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL
        });
      }
      return sendJson(response, 200, { iceServers });
    }

    if (request.method === "POST" && url.pathname === "/api/voice/join") {
      const { roomId, clientId, name } = await readJson(request);
      if (!roomId || !clientId) return sendJson(response, 400, { error: "Eksik oda bilgisi" });
      const user = await getAuthenticatedUser(request);
      if (!user) return sendJson(response, 401, { error: "Oturum gerekli" });
      const access = await voiceAccess(roomId, user.id);
      if (!access?.join) return sendJson(response, 403, { error: "Bu ses kanalına erişimin yok" });
      if (!voiceRooms.has(roomId)) voiceRooms.set(roomId, new Map());
      const room = voiceRooms.get(roomId);
      for (const [existingClientId, existingClient] of room) {
        if (existingClient.userId === user.id) room.delete(existingClientId);
      }
      if (access.userLimit > 0 && room.size >= access.userLimit) {
        return sendJson(response, 409, { error: "Bu ses kanalı dolu" });
      }
      const peers = [...room.values()].map(({ id, name: peerName, selfMuted, serverMuted }) => ({
        id,
        name: peerName,
        muted: selfMuted || serverMuted,
        serverMuted
      }));
      room.set(clientId, {
        id: clientId,
        userId: user.id,
        name: String(name || user.display_name || "YAAS üyesi").slice(0, 40),
        selfMuted: !access.speak,
        serverMuted: false,
        lastSeen: Date.now(),
        queue: []
      });
      return sendJson(response, 200, {
        peers,
        canSpeak: access.speak,
        canModerate: access.moderate,
        userLimit: access.userLimit,
        audioBitrate: access.audioBitrate,
        qualityMode: access.qualityMode
      });
    }

    if (request.method === "POST" && url.pathname === "/api/voice/signal") {
      const { roomId, from, to, signal } = await readJson(request);
      const user = await getAuthenticatedUser(request);
      const sender = voiceRooms.get(roomId)?.get(from);
      if (!user || !sender || sender.userId !== user.id) {
        return sendJson(response, 403, { error: "Ses odasına bağlı değilsin" });
      }
      const target = voiceRooms.get(roomId)?.get(to);
      if (target) target.queue.push({ from, signal });
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/voice/leave") {
      const { roomId, clientId } = await readJson(request);
      const user = await getAuthenticatedUser(request);
      const client = voiceRooms.get(roomId)?.get(clientId);
      if (user && client?.userId === user.id) voiceRooms.get(roomId)?.delete(clientId);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/voice/state") {
      const { roomId, clientId, muted } = await readJson(request);
      const user = await getAuthenticatedUser(request);
      const client = voiceRooms.get(roomId)?.get(clientId);
      if (!user || !client || client.userId !== user.id) {
        return sendJson(response, 403, { error: "Ses odasına bağlı değilsin" });
      }
      client.selfMuted = Boolean(muted);
      client.lastSeen = Date.now();
      return sendJson(response, 200, {
        ok: true,
        muted: client.selfMuted || client.serverMuted,
        serverMuted: client.serverMuted
      });
    }

    if (request.method === "POST" && url.pathname === "/api/voice/moderate") {
      const { roomId, clientId, targetId, action } = await readJson(request);
      const user = await getAuthenticatedUser(request);
      const actor = voiceRooms.get(roomId)?.get(clientId);
      const target = voiceRooms.get(roomId)?.get(targetId);
      if (!user || !actor || actor.userId !== user.id || !target || actor.id === target.id) {
        return sendJson(response, 403, { error: "Bu ses moderasyonu yapılamadı" });
      }
      const access = await voiceAccess(roomId, user.id);
      if (!access?.moderate) return sendJson(response, 403, { error: "Üyeleri yönetme iznin yok" });
      const channel = await query("SELECT server_id FROM channels WHERE id = $1", [roomId]);
      if (!channel.rowCount || !(await canModerateVoiceTarget(channel.rows[0].server_id, user.id, target.userId))) {
        return sendJson(response, 403, { error: "Bu üyeyi rol hiyerarşisi nedeniyle yönetemezsin" });
      }
      if (action === "disconnect") {
        target.queue.push({ from: "system", signal: { type: "moderator-disconnect" } });
        target.kickedAt = Date.now();
      } else if (action === "mute" || action === "unmute") {
        target.serverMuted = action === "mute";
        target.queue.push({ from: "system", signal: { type: "moderator-mute", muted: target.serverMuted } });
      } else {
        return sendJson(response, 400, { error: "Geçersiz moderasyon işlemi" });
      }
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/voice/poll") {
      const room = voiceRooms.get(url.searchParams.get("roomId"));
      const client = room?.get(url.searchParams.get("clientId"));
      const user = await getAuthenticatedUser(request);
      if (!client || !user || client.userId !== user.id) {
        return sendJson(response, 404, { error: "Oda bağlantısı bulunamadı" });
      }
      client.lastSeen = Date.now();
      const signals = client.queue.splice(0);
      const participants = [...room.values()].map(({ id, name, selfMuted, serverMuted }) => ({
        id,
        name,
        muted: selfMuted || serverMuted,
        serverMuted
      }));
      const shouldDisconnect = Boolean(client.kickedAt);
      if (shouldDisconnect) room.delete(client.id);
      return sendJson(response, 200, {
        signals,
        participants,
        serverMuted: client.serverMuted,
        shouldDisconnect
      });
    }

    sendJson(response, 404, { error: "Bulunamadı" });
  } catch {
    sendJson(response, 400, { error: "Geçersiz istek" });
  }
}

initializeDatabase()
  .then(() => {
    server.listen(port, "0.0.0.0", () => {
      console.log(`YAAS is running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed", error);
    process.exitCode = 1;
  });
