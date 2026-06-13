"use strict";

const crypto = require("crypto");
const { query } = require("./database");
const { createSession, hashPassword } = require("./auth");

const STATE_COOKIE = "yaas_oauth_state";
const providers = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile"
  },
  apple: {
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    scope: "name email"
  }
};

function providerEnabled(provider) {
  const key = provider.toUpperCase();
  return Boolean(providers[provider] && process.env[`${key}_CLIENT_ID`] && process.env[`${key}_CLIENT_SECRET`]);
}

function publicProviders() {
  return Object.fromEntries(Object.keys(providers).map((provider) => [provider, providerEnabled(provider)]));
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function startOAuth(provider, origin, response) {
  if (!providerEnabled(provider)) return false;
  const state = crypto.randomBytes(24).toString("base64url");
  const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;
  const config = providers[provider];
  const parameters = new URLSearchParams({
    client_id: process.env[`${provider.toUpperCase()}_CLIENT_ID`],
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scope,
    state
  });
  if (provider === "google") parameters.set("access_type", "online");
  if (provider === "apple") parameters.set("response_mode", "query");
  response.setHeader("Set-Cookie", `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  response.writeHead(302, { Location: `${config.authorizeUrl}?${parameters}` });
  response.end();
  return true;
}

function decodeJwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function fetchIdentity(provider, code, origin) {
  const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;
  const tokenResponse = await fetch(providers[provider].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env[`${provider.toUpperCase()}_CLIENT_ID`],
      client_secret: process.env[`${provider.toUpperCase()}_CLIENT_SECRET`],
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });
  if (!tokenResponse.ok) throw new Error(`${provider} token exchange failed`);
  const tokens = await tokenResponse.json();

  if (provider === "google") {
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (!profileResponse.ok) throw new Error("Google profile request failed");
    const profile = await profileResponse.json();
    return { id: profile.sub, email: profile.email, name: profile.name || profile.email.split("@")[0] };
  }

  const profile = decodeJwtPayload(tokens.id_token);
  return { id: profile.sub, email: profile.email, name: profile.email?.split("@")[0] || "Apple üyesi" };
}

function makeHandle(email) {
  const base = email.split("@")[0].replace(/[^\w.]/g, "").toLowerCase().slice(0, 18) || "yaasuye";
  return `${base}-${crypto.randomBytes(2).toString("hex")}`;
}

async function loginOAuthUser(provider, identity, response) {
  if (!identity.id || !identity.email) throw new Error("Sosyal hesap e-posta bilgisi vermedi");
  let result = await query(
    `SELECT u.id FROM oauth_accounts o JOIN users u ON u.id = o.user_id
      WHERE o.provider = $1 AND o.provider_user_id = $2`,
    [provider, identity.id]
  );
  let userId = result.rows[0]?.id;

  if (!userId) {
    result = await query("SELECT id FROM users WHERE email = $1", [identity.email.toLowerCase()]);
    userId = result.rows[0]?.id || crypto.randomUUID();
    if (!result.rows[0]) {
      await query(
        `INSERT INTO users (id, email, display_name, handle, password_hash, is_site_owner)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          identity.email.toLowerCase(),
          String(identity.name || "YAAS üyesi").slice(0, 40),
          makeHandle(identity.email),
          await hashPassword(crypto.randomBytes(32).toString("hex")),
          Boolean(process.env.OWNER_EMAIL && identity.email.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase())
        ]
      );
    }
    await query(
      "INSERT INTO oauth_accounts (provider, provider_user_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [provider, identity.id, userId]
    );
  }
  await createSession(userId, response);
}

async function finishOAuth(provider, request, response, origin, searchParams) {
  if (!providerEnabled(provider)) return false;
  const state = parseCookies(request)[STATE_COOKIE];
  if (!state || state !== searchParams.get("state") || !searchParams.get("code")) {
    throw new Error("Geçersiz sosyal giriş isteği");
  }
  const identity = await fetchIdentity(provider, searchParams.get("code"), origin);
  await loginOAuthUser(provider, identity, response);
  response.setHeader("Set-Cookie", [
    response.getHeader("Set-Cookie"),
    `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  ]);
  response.writeHead(302, { Location: "/" });
  response.end();
  return true;
}

module.exports = { finishOAuth, publicProviders, startOAuth };
