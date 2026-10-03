"use strict";

const crypto = require("crypto");
const { query } = require("./database");

const buckets = new Map();
const alertState = new Map();
const securityLogSalt = process.env.SECURITY_LOG_SALT || crypto.randomBytes(32).toString("hex");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const POLICIES = {
  global: { limit: 600, windowMs: 60_000 },
  auth: { limit: 12, windowMs: 60_000 },
  failedLogin: { limit: 5, windowMs: 15 * 60_000 },
  register: { limit: 5, windowMs: 15 * 60_000 },
  write: { limit: 120, windowMs: 60_000 },
  social: { limit: 20, windowMs: 60_000 },
  messages: { limit: 60, windowMs: 60_000 },
  create: { limit: 20, windowMs: 60_000 },
  realtime: { limit: 900, windowMs: 60_000 }
};

function clientIp(request) {
  if (process.env.TRUST_CLOUDFLARE === "1" && request.headers["cf-connecting-ip"]) return String(request.headers["cf-connecting-ip"]).trim();
  if (process.env.TRUST_PROXY === "1" && request.headers["x-forwarded-for"]) {
    return String(request.headers["x-forwarded-for"]).split(",").at(-1).trim();
  }
  return String(request.socket?.remoteAddress || "unknown").trim();
}

function requestPolicy(request) {
  const pathname = String(request.url || "").split("?")[0];
  if (pathname === "/api/auth/register") return "register";
  if (pathname.startsWith("/api/auth/")) return "auth";
  if (pathname.endsWith("/chat") || (request.method === "POST" && /^\/api\/dms\//.test(pathname))) return "messages";
  if (pathname.startsWith("/api/voice/") || pathname.startsWith("/api/stream-rtc/")) return "realtime";
  if (request.method === "POST" && (/\/friends\/requests$/.test(pathname) || pathname === "/api/message-requests")) return "social";
  if (request.method === "POST" && (/\/messages$/.test(pathname) || /\/chat$/.test(pathname))) return "messages";
  if (request.method === "POST" && (/\/servers$/.test(pathname) || /\/channels$/.test(pathname) || /\/invites$/.test(pathname))) return "create";
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) return "write";
  return "global";
}

function applyRateLimit(request, response) {
  const name = requestPolicy(request);
  const policy = POLICIES[name];
  const now = Date.now();
  const key = `${clientIp(request)}:${name}`;
  const result = consumeRateLimit(key, name, now);
  const { bucket } = result;
  const remaining = Math.max(0, policy.limit - bucket.count);
  response.setHeader("RateLimit-Limit", String(policy.limit));
  response.setHeader("RateLimit-Remaining", String(remaining));
  response.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (result.allowed) return true;
  response.writeHead(429, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000))
  });
  response.end(JSON.stringify({ error: "Çok fazla istek. Biraz bekleyip tekrar dene." }));
  if (bucket.count === policy.limit + 1 || bucket.count % 100 === 0) recordSecurityEvent({ request, eventType: "rate_limit", severity: "high", metadata: { policy: name, requestCount: bucket.count } }).catch(() => {});
  return false;
}

function consumeRateLimit(key, policyName, now = Date.now()) {
  const policy = POLICIES[policyName];
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= 20000 && !bucket) buckets.delete(buckets.keys().next().value);
    bucket = { count: 0, resetAt: now + policy.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return { allowed: bucket.count <= policy.limit, bucket: { ...bucket } };
}

function redactMetadata(metadata = {}) {
  const output = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/password|token|secret|cookie|authorization/i.test(key)) continue;
    if (value && typeof value === "object") output[key] = redactMetadata(value);
    else output[key] = typeof value === "string" ? value.slice(0, 180) : value;
  }
  return output;
}

async function recordSecurityEvent({ request, userId = null, eventType, severity = "info", metadata = {} }) {
  const safeMetadata = redactMetadata(metadata);
  const ipHash = crypto.createHmac("sha256", securityLogSalt).update(clientIp(request)).digest("hex");
  await query(
    `INSERT INTO security_events (id, event_type, severity, user_id, ip_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [crypto.randomUUID(), eventType, severity, userId, ipHash, JSON.stringify(safeMetadata)]
  );
  if (["critical", "high"].includes(severity)) queueAlert(eventType, severity, safeMetadata);
}

async function recordAdminAudit({ request, actorUserId, action, targetType = "system", targetId = null, metadata = {} }) {
  await query(
    `INSERT INTO admin_audit_logs (id, actor_user_id, action, target_type, target_id, ip_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), actorUserId, action, targetType, targetId,
      crypto.createHmac("sha256", securityLogSalt).update(clientIp(request)).digest("hex"),
      JSON.stringify(redactMetadata(metadata))]
  );
}

function queueAlert(eventType, severity, metadata) {
  const webhook = process.env.SECURITY_ALERT_WEBHOOK_URL;
  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.SECURITY_ALERT_FROM && process.env.SECURITY_ALERT_EMAIL);
  if (!webhook && !emailConfigured) return;
  const now = Date.now();
  const current = alertState.get(eventType) || { count: 0, sentAt: 0, timer: null };
  current.count += 1;
  if (now - current.sentAt < 5 * 60_000) {
    if (!current.timer) {
      current.timer = setTimeout(() => {
        current.timer = null;
        if (current.count > 0) {
          current.count -= 1;
          current.sentAt = 0;
          queueAlert(eventType, severity, metadata);
        }
      }, 5 * 60_000 - (now - current.sentAt));
      current.timer.unref();
    }
    alertState.set(eventType, current);
    return;
  }
  const count = current.count;
  if (current.timer) clearTimeout(current.timer);
  current.timer = null;
  current.count = 0;
  current.sentAt = now;
  alertState.set(eventType, current);
  if (webhook) fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ service: "YAAS", eventType, severity, count, metadata, occurredAt: new Date().toISOString() }),
    signal: AbortSignal.timeout(5000)
  }).then(response => { if (!response.ok) console.error("Security webhook delivery failed", response.status); }).catch(() => console.error("Security webhook delivery unavailable"));
  if (emailConfigured) fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: process.env.SECURITY_ALERT_FROM, to: [process.env.SECURITY_ALERT_EMAIL], subject: `YAAS güvenlik uyarısı: ${eventType}`, text: `Önem: ${severity}\nOlay: ${eventType}\nOlay sayısı: ${count}\nZaman: ${new Date().toISOString()}\nYAAS Güvenlik Merkezi'ni inceleyin.` }),
    signal: AbortSignal.timeout(5000)
  }).then(response => { if (!response.ok) console.error("Security email delivery failed", response.status); }).catch(() => console.error("Security email delivery unavailable"));
}

function isUuid(value) {
  return UUID_RE.test(String(value || ""));
}

function validateImageValue(value) {
  const image = String(value || "").trim();
  if (!image) return "";
  if (/^https:\/\//i.test(image) && image.length <= 500) return image;
  const match = image.match(/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[2], "base64");
  if (decoded.length > 512_000) return null;
  const signatures = {
    png: decoded.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
    jpeg: decoded.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
    webp: decoded.subarray(0, 4).toString() === "RIFF" && decoded.subarray(8, 12).toString() === "WEBP"
  };
  return signatures[match[1].toLowerCase()] ? image : null;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
}, 60_000).unref();

module.exports = {
  POLICIES,
  applyRateLimit,
  clientIp,
  consumeRateLimit,
  isUuid,
  recordAdminAudit,
  recordSecurityEvent,
  requestPolicy,
  queueAlert,
  redactMetadata,
  validateImageValue
};
