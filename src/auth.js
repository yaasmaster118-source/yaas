"use strict";

const crypto = require("crypto");
const { promisify } = require("util");
const { query } = require("./database");

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "yaas_session";
const SESSION_DAYS = 30;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash).split(":");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(derived);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

async function createSession(userId, response) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), userId, hashToken(token), expiresAt]
  );
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}

async function destroySession(request, response) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

async function getAuthenticatedUser(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const result = await query(
    `SELECT u.id, u.email, u.display_name, u.handle, u.is_site_owner
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashToken(token)]
  );
  return result.rows[0] || null;
}

async function requireUser(request, response, sendJson) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    sendJson(response, 401, { error: "Oturum gerekli" });
    return null;
  }
  return user;
}

module.exports = {
  createSession,
  destroySession,
  getAuthenticatedUser,
  hashPassword,
  requireUser,
  verifyPassword
};
