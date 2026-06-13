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
  if (provider === "google") {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }
  if (provider === "apple") {
    return Boolean(
      process.env.APPLE_CLIENT_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY
    );
  }
  return false;
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
  if (provider === "apple") parameters.set("response_mode", "form_post");
  const appleCookie = provider === "apple" && process.env.NODE_ENV === "production"
    ? "; SameSite=None; Secure"
    : "; SameSite=Lax";
  response.setHeader("Set-Cookie", `${STATE_COOKIE}=${state}; Path=/; HttpOnly${appleCookie}; Max-Age=600`);
  response.writeHead(302, { Location: `${config.authorizeUrl}?${parameters}` });
  response.end();
  return true;
}

function decodeJwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function verifyAppleIdToken(token) {
  const [encodedHeader, encodedPayload, encodedSignature] = String(token || "").split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error("Apple kimlik belirteci geçersiz");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (header.alg !== "RS256" || !header.kid) throw new Error("Apple kimlik imzası geçersiz");

  const keysResponse = await fetch("https://appleid.apple.com/auth/keys");
  if (!keysResponse.ok) throw new Error("Apple doğrulama anahtarları alınamadı");
  const keys = await keysResponse.json();
  const jwk = keys.keys?.find((key) => key.kid === header.kid && key.alg === "RS256");
  if (!jwk) throw new Error("Apple doğrulama anahtarı bulunamadı");

  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    crypto.createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url")
  );
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    !verified ||
    payload.iss !== "https://appleid.apple.com" ||
    !audience.includes(process.env.APPLE_CLIENT_ID) ||
    Number(payload.exp) <= now
  ) {
    throw new Error("Apple kimlik doğrulaması başarısız");
  }
  return payload;
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function appleClientSecret(now = Math.floor(Date.now() / 1000)) {
  const header = encodeJwtPart({ alg: "ES256", kid: process.env.APPLE_KEY_ID });
  const payload = encodeJwtPart({
    iss: process.env.APPLE_TEAM_ID,
    iat: now,
    exp: now + 300,
    aud: "https://appleid.apple.com",
    sub: process.env.APPLE_CLIENT_ID
  });
  const signingInput = `${header}.${payload}`;
  const privateKey = String(process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: crypto.createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363"
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

function clientSecret(provider) {
  return provider === "apple" ? appleClientSecret() : process.env.GOOGLE_CLIENT_SECRET;
}

async function fetchIdentity(provider, code, origin, callbackUser) {
  const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;
  const tokenResponse = await fetch(providers[provider].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env[`${provider.toUpperCase()}_CLIENT_ID`],
      client_secret: clientSecret(provider),
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
    if (profile.email_verified === false) throw new Error("Google e-posta adresi doğrulanmamış");
    return { id: profile.sub, email: profile.email, name: profile.name || profile.email.split("@")[0] };
  }

  const profile = await verifyAppleIdToken(tokens.id_token);
  let appleUser = {};
  try {
    appleUser = callbackUser ? JSON.parse(callbackUser) : {};
  } catch {}
  const suppliedName = [appleUser.name?.firstName, appleUser.name?.lastName].filter(Boolean).join(" ");
  return {
    id: profile.sub,
    email: profile.email,
    name: suppliedName || profile.email?.split("@")[0] || "Apple üyesi"
  };
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

async function finishOAuth(provider, request, response, origin, callbackValues) {
  if (!providerEnabled(provider)) return false;
  const state = parseCookies(request)[STATE_COOKIE];
  const getValue = (key) => typeof callbackValues.get === "function"
    ? callbackValues.get(key)
    : callbackValues[key];
  if (!state || state !== getValue("state") || !getValue("code")) {
    throw new Error("Geçersiz sosyal giriş isteği");
  }
  const identity = await fetchIdentity(provider, getValue("code"), origin, getValue("user"));
  await loginOAuthUser(provider, identity, response);
  response.setHeader("Set-Cookie", [
    response.getHeader("Set-Cookie"),
    `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  ]);
  response.writeHead(302, { Location: "/" });
  response.end();
  return true;
}

module.exports = { appleClientSecret, finishOAuth, publicProviders, startOAuth, verifyAppleIdToken };
