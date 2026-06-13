const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleApi } = require("./src/api");

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
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { error: "Geçersiz istek kaynağı" });
      return;
    }
    handleApi(request, response, { getOrigin, readJson, sendJson });
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
    response.end(JSON.stringify({ status: "ok", version: "1.1.0-dev" }));
    return;
  }

  const requestPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
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

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

function cleanVoiceRooms() {
  const cutoff = Date.now() - 30_000;
  for (const [roomId, room] of voiceRooms) {
    for (const [clientId, client] of room) {
      if (client.lastSeen < cutoff) room.delete(clientId);
    }
    if (room.size === 0) voiceRooms.delete(roomId);
  }
}

async function handleVoiceApi(request, response) {
  cleanVoiceRooms();
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "POST" && url.pathname === "/api/voice/join") {
      const { roomId, clientId, name } = await readJson(request);
      if (!roomId || !clientId) return sendJson(response, 400, { error: "Eksik oda bilgisi" });
      if (!voiceRooms.has(roomId)) voiceRooms.set(roomId, new Map());
      const room = voiceRooms.get(roomId);
      const peers = [...room.values()].map(({ id, name: peerName }) => ({ id, name: peerName }));
      room.set(clientId, { id: clientId, name: String(name || "YAAS üyesi").slice(0, 40), lastSeen: Date.now(), queue: [] });
      return sendJson(response, 200, { peers });
    }

    if (request.method === "POST" && url.pathname === "/api/voice/signal") {
      const { roomId, from, to, signal } = await readJson(request);
      const target = voiceRooms.get(roomId)?.get(to);
      if (target) target.queue.push({ from, signal });
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/voice/leave") {
      const { roomId, clientId } = await readJson(request);
      voiceRooms.get(roomId)?.delete(clientId);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/voice/poll") {
      const room = voiceRooms.get(url.searchParams.get("roomId"));
      const client = room?.get(url.searchParams.get("clientId"));
      if (!client) return sendJson(response, 404, { error: "Oda bağlantısı bulunamadı" });
      client.lastSeen = Date.now();
      const signals = client.queue.splice(0);
      const participants = [...room.values()].map(({ id, name }) => ({ id, name }));
      return sendJson(response, 200, { signals, participants });
    }

    sendJson(response, 404, { error: "Bulunamadı" });
  } catch {
    sendJson(response, 400, { error: "Geçersiz istek" });
  }
}

server.listen(port, "0.0.0.0", () => {
  console.log(`YAAS is running at http://localhost:${port}`);
});
