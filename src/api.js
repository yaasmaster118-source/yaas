"use strict";

const crypto = require("crypto");
const { validateDmAttachment, mediaRange } = require("./dm-media");
const { enforceMediaDuration } = require("./media-duration");
const {emailReady,issueToken,consumeToken,isBlocked}=require('./account-security');
const { query, transaction } = require("./database");
const {
  createSession,
  destroySession,
  getAuthenticatedUser,
  hashPassword,
  requireUser,
  verifyPassword
} = require("./auth");
const { ALL_PERMISSIONS, ROLE_TEMPLATES, validPermissions } = require("./permissions");
const { finishOAuth, publicProviders, startOAuth } = require("./oauth");
const { clientIp, consumeRateLimit, recordAdminAudit, recordSecurityEvent, validateImageValue } = require("./security");
const DUMMY_PASSWORD_HASH = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
const activeUsers = new Map();
let presenceCleanupAt=0;

function text(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return text(value, 254).toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function profileImageValue(value) {
  return validateImageValue(value);
}

async function serverSummary(serverId) {
  const result = await query(
    `SELECT s.id, s.name, s.description, s.icon_color, s.logo_url, s.owner_id, s.created_at,
            COUNT(m.user_id)::int AS member_count
       FROM servers s
       LEFT JOIN memberships m ON m.server_id = s.id
      WHERE s.id = $1
      GROUP BY s.id`,
    [serverId]
  );
  return result.rows[0] || null;
}

function avatarFrame(value) {
  return ["none", "gold", "emerald", "royal", "neon"].includes(value) ? value : "none";
}

function roleIconValue(value, name = "") {
  const icon = text(value, 8);
  if (icon) return icon;
  const lowerName = String(name || "").toLowerCase();
  if (lowerName.includes("owner") || lowerName.includes("lider")) return "👑";
  if (lowerName.includes("admin")) return "🛡";
  if (lowerName.includes("mod")) return "🔨";
  if (lowerName.includes("staff")) return "⭐";
  return "◆";
}

function strongPassword(password) {
  return String(password || "").length >= 8
    && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password)
    && /\d/.test(password);
}

function isUniqueConflict(error) {
  return error?.code === "23505" || /unique|duplicate/i.test(String(error?.message || ""));
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

function qualityMode(value) {
  return ["auto", "data", "high"].includes(value) ? value : "auto";
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function makeHandle(email) {
  const base = email.split("@")[0].replace(/[^\w.]/g, "").toLowerCase().slice(0, 20) || "yaasuye";
  return `${base}-${crypto.randomBytes(2).toString("hex")}`;
}

async function membership(serverId, userId) {
  const result = await query(
    `SELECT s.id, s.owner_id FROM servers s
      JOIN memberships m ON m.server_id = s.id
     WHERE s.id = $1 AND m.user_id = $2`,
    [serverId, userId]
  );
  return result.rows[0] || null;
}

async function permissions(serverId, userId) {
  const member = await membership(serverId, userId);
  if (!member) return null;
  if (member.owner_id === userId) return new Set(ALL_PERMISSIONS);
  const result = await query(
    `SELECT r.permissions FROM member_roles mr
      JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = $1 AND mr.user_id = $2`,
    [serverId, userId]
  );
  return new Set(result.rows.flatMap((row) => jsonArray(row.permissions)));
}

async function highestRolePosition(serverId, userId) {
  const server = await query("SELECT owner_id FROM servers WHERE id = $1", [serverId]);
  if (server.rows[0]?.owner_id === userId) return Number.POSITIVE_INFINITY;
  const result = await query(
    `SELECT MAX(r.position) AS position FROM member_roles mr
      JOIN roles r ON r.id = mr.role_id
     WHERE mr.server_id = $1 AND mr.user_id = $2`,
    [serverId, userId]
  );
  return Number(result.rows[0]?.position || 0);
}

async function requirePermission(response, sendJson, serverId, userId, permission) {
  const granted = await permissions(serverId, userId);
  if (!granted) {
    sendJson(response, 404, { error: "Sunucu bulunamadı" });
    return null;
  }
  if (!granted.has(permission)) {
    sendJson(response, 403, { error: "Bu işlem için iznin yok" });
    return null;
  }
  return granted;
}

function streamVisibility(value) {
  return ["global", "server", "friends"].includes(value) ? value : "server";
}

async function visibleStream(streamId, userId) {
  const result = await query(
    `SELECT ss.id, ss.title, ss.visibility, ss.status, ss.started_at, ss.server_id,
            ss.viewer_count::int AS viewer_count,
            u.id AS user_id, u.display_name, u.handle, u.avatar_url, u.avatar_frame,
            s.name AS server_name, s.logo_url AS server_logo_url, s.icon_color AS server_icon_color
       FROM stream_sessions ss
       JOIN users u ON u.id = ss.user_id
       LEFT JOIN servers s ON s.id = ss.server_id
      WHERE ss.id = $2
        AND ss.status = 'live'
        AND (
          ss.visibility = 'global'
          OR ss.user_id = $1
          OR (ss.visibility = 'friends' AND EXISTS (
            SELECT 1 FROM friendships f
             WHERE f.status = 'accepted'
               AND ((f.requester_id = $1 AND f.addressee_id = ss.user_id)
                 OR (f.requester_id = ss.user_id AND f.addressee_id = $1))
          ))
          OR (ss.visibility = 'server' AND ss.server_id IN (
            SELECT server_id FROM memberships WHERE user_id = $1
          ))
        )`,
    [userId, streamId]
  );
  return result.rows[0] || null;
}

async function refreshStreamViewerCount(streamId) {
  await query(
    `UPDATE stream_sessions
        SET viewer_count = (SELECT COUNT(*) FROM stream_viewers WHERE stream_id = $1)
      WHERE id = $1`,
    [streamId]
  );
  const result = await query("SELECT viewer_count::int AS viewer_count FROM stream_sessions WHERE id = $1", [streamId]);
  return Number(result.rows[0]?.viewer_count || 0);
}

async function ensureStreamerRole(serverId) {
  const template = ROLE_TEMPLATES.find((role) => role.name === "Yayinci");
  if (!template) return;
  await query(
    `INSERT INTO roles (id, server_id, name, color, role_icon, role_hoist, position, permissions, is_system)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, TRUE)
     ON CONFLICT(server_id, name) DO NOTHING`,
    [
      crypto.randomUUID(),
      serverId,
      template.name,
      template.color,
      roleIconValue("", template.name),
      false,
      template.position,
      JSON.stringify(template.permissions)
    ]
  );
}

async function areFriends(firstUserId, secondUserId) {
  const result = await query(
    `SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1))`,
    [firstUserId, secondUserId]
  );
  return Boolean(result.rowCount);
}

const SERVER_TEMPLATES = {
  custom: [
    { name: "YAZI KANALLARI", channels: [{ name: "genel", type: "text" }] },
    { name: "SES KANALLARI", channels: [{ name: "Genel", type: "voice" }] }
  ],
  gaming: [
    { name: "OYUN TOPLULUĞU", channels: [{ name: "lobi", type: "text" }, { name: "takım-ara", type: "text" }] },
    { name: "SES ODALARI", channels: [{ name: "Oyun Odası", type: "voice" }] }
  ],
  school: [
    { name: "OKUL KULÜBÜ", channels: [{ name: "duyurular", type: "text" }, { name: "sohbet", type: "text" }] },
    { name: "BULUŞMA ODALARI", channels: [{ name: "Kulüp Odası", type: "voice" }] }
  ],
  study: [
    { name: "ÇALIŞMA ALANI", channels: [{ name: "planlama", type: "text" }, { name: "kaynaklar", type: "text" }] },
    { name: "ODAK ODALARI", channels: [{ name: "Sessiz Çalışma", type: "voice" }] }
  ],
  friends: [
    { name: "ARKADAŞLAR", channels: [{ name: "sohbet", type: "text" }, { name: "fotoğraflar", type: "text" }] },
    { name: "TAKILMA ODALARI", channels: [{ name: "Muhabbet", type: "voice" }] }
  ],
  creators: [
    { name: "ÜRETİM", channels: [{ name: "çalışmalar", type: "text" }, { name: "geri-bildirim", type: "text" }] },
    { name: "ATÖLYE", channels: [{ name: "Birlikte Üret", type: "voice" }] }
  ],
  local: [
    { name: "TOPLULUK", channels: [{ name: "duyurular", type: "text" }, { name: "etkinlikler", type: "text" }] },
    { name: "BULUŞMA", channels: [{ name: "Topluluk Odası", type: "voice" }] }
  ]
};

async function createServer(client, user, body) {
  const serverId = crypto.randomUUID();
  const iconColor = /^#[0-9a-f]{6}$/i.test(String(body.iconColor || "")) ? body.iconColor : "#c9f34b";
  const logoUrl = profileImageValue(body.logoUrl);
  if (logoUrl === null) {
    const error = new Error("Sunucu logosu icin gecerli bir gorsel baglantisi kullanmalisin");
    error.statusCode = 400;
    throw error;
  }
  await client.query(
    "INSERT INTO servers (id, name, description, icon_color, logo_url, owner_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [serverId, text(body.name, 40), text(body.description, 180), iconColor, logoUrl, user.id]
  );
  await client.query("INSERT INTO memberships (server_id, user_id) VALUES ($1, $2)", [serverId, user.id]);
  const roles = {};
  for (const template of ROLE_TEMPLATES) {
    const roleId = crypto.randomUUID();
    roles[template.name] = roleId;
    await client.query(
      `INSERT INTO roles (id, server_id, name, color, role_icon, role_hoist, position, permissions, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, TRUE)`,
      [roleId, serverId, template.name, template.color, roleIconValue("", template.name), template.name === "Owner", template.position, JSON.stringify(template.permissions)]
    );
  }
  await client.query(
    "INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)",
    [serverId, user.id, roles.Owner]
  );
  const template = SERVER_TEMPLATES[body.template] || SERVER_TEMPLATES.custom;
  for (const [categoryIndex, category] of template.entries()) {
    const categoryId = crypto.randomUUID();
    await client.query(
      "INSERT INTO channel_categories (id, server_id, name, position) VALUES ($1, $2, $3, $4)",
      [categoryId, serverId, category.name, (categoryIndex + 1) * 10]
    );
    for (const [channelIndex, channel] of category.channels.entries()) {
      await client.query(
        `INSERT INTO channels (id, server_id, category_id, name, type, position)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), serverId, categoryId, channel.name, channel.type, (channelIndex + 1) * 10]
      );
    }
  }
  return await serverSummary(serverId);
}

async function handleApi(request, response, helpers) {
  const { readForm, readJson, sendJson, getOrigin } = helpers;
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const method = request.method;

  try {
    if (method === "GET" && url.pathname === "/api/auth/providers") {
      return sendJson(response, 200, { providers: publicProviders() });
    }

    const oauthStart = url.pathname.match(/^\/api\/auth\/oauth\/(google|apple)$/);
    if (method === "GET" && oauthStart) {
      if (!startOAuth(oauthStart[1], getOrigin(request), response)) {
        return sendJson(response, 503, { error: "Bu giriş yöntemi henüz ayarlanmadı" });
      }
      return;
    }

    const oauthCallback = url.pathname.match(/^\/api\/auth\/oauth\/(google|apple)\/callback$/);
    if (oauthCallback && (method === "GET" || (method === "POST" && oauthCallback[1] === "apple"))) {
      const callbackValues = method === "POST" ? await readForm(request) : Object.fromEntries(url.searchParams);
      try {
        await finishOAuth(oauthCallback[1], request, response, getOrigin(request), callbackValues);
      } catch (error) {
        console.error("OAuth failed", { code: String(error.code || "OAUTH_ERROR").slice(0, 40) });
        const providerName = oauthCallback[1] === "google" ? "Google" : "Apple";
        response.writeHead(302, {
          Location: `/?authError=${encodeURIComponent(`${providerName} girişi tamamlanamadı. Client ID, secret ve yönlendirme adresini kontrol et.`)}`
        });
        response.end();
      }
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/register") {
      const body = await readJson(request);
      const email = normalizeEmail(body.email);
      const name = text(body.name, 40);
      const password = String(body.password || "");
      if (password.length > 1024) return sendJson(response, 400, { error: "Geçersiz istek" });
      if (!validEmail(email) || name.length < 2 || !strongPassword(password)) {
        return sendJson(response, 400, { error: "Geçerli ad, e-posta ve en az 8 karakterli, harf ve rakam içeren şifre gerekli" });
      }
      if ((await query("SELECT 1 FROM users WHERE email = $1", [email])).rowCount) {
        return sendJson(response, 409, { error: "Bu e-posta zaten kayıtlı. Lütfen giriş yap." });
      }
      const user = { id: crypto.randomUUID(), email, name, handle: makeHandle(email) };
      if (email === String(process.env.OWNER_EMAIL || "").trim().toLowerCase()) {
        return sendJson(response, 403, { error: "Bu hesap için doğrulanmış sosyal giriş veya yönetici kurulumu gerekli" });
      }
      const isSiteOwner = false;
      try {
        await query(
          "INSERT INTO users (id, email, display_name, handle, password_hash, is_site_owner) VALUES ($1, $2, $3, $4, $5, $6)",
          [user.id, email, name, user.handle, await hashPassword(password), isSiteOwner]
        );
      } catch (error) {
        if (isUniqueConflict(error)) {
          return sendJson(response, 409, { error: "Bu e-posta zaten kayıtlı. Lütfen giriş yap." });
        }
        throw error;
      }
      await createSession(user.id, response);
      return sendJson(response, 201, {
        user: { id: user.id, email, displayName: name, handle: user.handle, bio: "", avatar_url: "", avatar_frame: "none", is_site_owner: isSiteOwner }
      });
    }

    if(method==='POST' && url.pathname==='/api/auth/reset-request'){
      const body=await readJson(request);
      if(!emailReady())return sendJson(response,503,{error:'E-posta hizmeti henüz hazır değil. Daha sonra tekrar dene.'});
      const result=await query('SELECT id,email FROM users WHERE email=$1',[normalizeEmail(body.email)]);
      if(result.rowCount)await issueToken(result.rows[0],'reset');
      return sendJson(response,200,{message:'Bu adres kayıtlıysa şifre yenileme bağlantısı gönderildi.'});
    }
    if(method==='POST' && ['/api/auth/reset-complete','/api/auth/verify-complete'].includes(url.pathname)){
      const body=await readJson(request), purpose=url.pathname.includes('reset')?'reset':'verify';
      if(purpose==='reset'&&(!strongPassword(body.password)||String(body.password).length>1024))return sendJson(response,400,{error:'Şifre en az 8 karakter, harf ve rakam içermeli.'});
      const ok=await consumeToken(body.token,purpose,String(body.password||''));
      return sendJson(response,ok?200:400,ok?{ok:true}:{error:'Bağlantı geçersiz veya süresi dolmuş.'});
    }

    if (method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(request);
      if (String(body.password || "").length > 1024) return sendJson(response, 400, { error: "Geçersiz istek" });
      const result = await query(
        "SELECT id, email, display_name, handle, bio, avatar_url, avatar_frame, password_hash, is_site_owner FROM users WHERE email = $1",
        [normalizeEmail(body.email)]
      );
      const user = result.rows[0];
      const passwordMatches = await verifyPassword(String(body.password || ""), user?.password_hash || DUMMY_PASSWORD_HASH);
      if (!user || !passwordMatches) {
        const failures = consumeRateLimit(`login-failure:${clientIp(request)}`, "failedLogin");
        await recordSecurityEvent({ request, eventType: "login_failed", severity: failures.allowed ? "warning" : "high", metadata: { attempts: failures.bucket.count } });
        return sendJson(response, 401, { error: "E-posta veya sifre hatali" });
      }
      await createSession(user.id, response);
      await recordSecurityEvent({ request, userId: user.id, eventType: "login_succeeded" });
      return sendJson(response, 200, {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          handle: user.handle,
          bio: user.bio,
          avatar_url: user.avatar_url,
          avatar_frame: user.avatar_frame,
          is_site_owner: user.is_site_owner
        }
      });
    }

    if (method === "POST" && url.pathname === "/api/auth/logout") {
      await destroySession(request, response);
      return sendJson(response, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/me") {
      return sendJson(response, 200, { user: await getAuthenticatedUser(request) });
    }

    const user = await requireUser(request, response, sendJson);
    if(user){
      const now=Date.now();activeUsers.set(user.id,now);
      if(now>presenceCleanupAt){for(const [id,seen] of activeUsers)if(now-seen>60000)activeUsers.delete(id);presenceCleanupAt=now+60000;}
    }
    if (!user) return;
    if(method==='GET'&&url.pathname==='/api/account/security'){
      const current=await query('SELECT email_verified FROM users WHERE id=$1',[user.id]);
      const blocks=await query('SELECT u.id,u.display_name,u.handle FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.user_id=$1',[user.id]);
      return sendJson(response,200,{emailVerified:Boolean(current.rows[0].email_verified),emailReady:emailReady(),blocks:blocks.rows});
    }
    if(method==='POST'&&url.pathname==='/api/account/verify-request'){
      await issueToken(user,'verify');return sendJson(response,200,{ok:true});
    }
    const blockRoute=url.pathname.match(/^\/api\/blocks\/([0-9a-f-]+)$/i);
    if(blockRoute&&['POST','DELETE'].includes(method)){
      const target=blockRoute[1];
      if(target===user.id||!(await query('SELECT id FROM users WHERE id=$1',[target])).rowCount)return sendJson(response,400,{error:'Geçersiz kullanıcı'});
      if(method==='POST')await query('INSERT INTO user_blocks(user_id,blocked_id) VALUES ($1,$2) ON CONFLICT(user_id,blocked_id) DO NOTHING',[user.id,target]);
      else await query('DELETE FROM user_blocks WHERE user_id=$1 AND blocked_id=$2',[user.id,target]);
      return sendJson(response,200,{ok:true});
    }
    if(method==='POST'&&url.pathname==='/api/reports'){
      const body=await readJson(request),reason=text(body.reason,1000);
      if(reason.length<5||body.targetId===user.id||!(await query('SELECT id FROM users WHERE id=$1',[body.targetId])).rowCount)return sendJson(response,400,{error:'Geçerli kullanıcı ve en az 5 karakter açıklama gerekli.'});
      const id=crypto.randomUUID();await query('INSERT INTO user_reports(id,reporter_id,target_id,reason) VALUES ($1,$2,$3,$4)',[id,user.id,body.targetId,reason]);
      await recordSecurityEvent({request,userId:user.id,eventType:'user_report',severity:'high',metadata:{reportId:id}});
      return sendJson(response,201,{ok:true});
    }
    if(method==='GET'&&url.pathname==='/api/admin/reports'){
      if(!user.is_site_owner)return sendJson(response,403,{error:'Yetki gerekli'});
      const result=await query('SELECT r.*,u.handle AS target_handle FROM user_reports r JOIN users u ON u.id=r.target_id ORDER BY r.created_at DESC LIMIT 100');
      return sendJson(response,200,{reports:result.rows});
    }
    const reportRoute=url.pathname.match(/^\/api\/admin\/reports\/([0-9a-f-]+)$/i);
    if(method==='PATCH'&&reportRoute){
      if(!user.is_site_owner)return sendJson(response,403,{error:'Yetki gerekli'});
      const body=await readJson(request);if(!['open','closed'].includes(body.status))return sendJson(response,400,{error:'Geçersiz durum'});
      await query('UPDATE user_reports SET status=$2 WHERE id=$1',[reportRoute[1],body.status]);return sendJson(response,200,{ok:true});
    }

    if (method === "GET" && url.pathname === "/api/admin/security/summary") {
      if (!user.is_site_owner) {
        await recordSecurityEvent({ request, userId: user.id, eventType: "admin_access_denied", severity: "high", metadata: { path: url.pathname } });
        return sendJson(response, 403, { error: "Bu alan yalnızca YAAS sahibi içindir" });
      }
      const [recent, audits] = await Promise.all([
        query(`SELECT event_type, severity, metadata, created_at FROM security_events ORDER BY created_at DESC LIMIT 200`),
        query(`SELECT action, target_type, target_id, metadata, created_at FROM admin_audit_logs ORDER BY created_at DESC LIMIT 30`)
      ]);
      const counts = {};
      for (const event of recent.rows) counts[event.event_type] = (counts[event.event_type] || 0) + 1;
      await recordAdminAudit({ request, actorUserId: user.id, action: "security_dashboard_view", targetType: "security" });
      return sendJson(response, 200, {
        security: {
          counts,
          recentEvents: recent.rows.slice(0, 30),
          auditLogs: audits.rows,
          alertWebhookConfigured: Boolean(process.env.SECURITY_ALERT_WEBHOOK_URL),
          alertEmailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.SECURITY_ALERT_FROM && process.env.SECURITY_ALERT_EMAIL),
          persistentDatabase: Boolean(process.env.DATABASE_URL)
        }
      });
    }

    if (method === "PATCH" && url.pathname === "/api/me/profile") {
      const body = await readJson(request);
      const displayName = body.displayName === undefined ? null : text(body.displayName, 40);
      const bio = body.bio === undefined ? null : text(body.bio, 240);
      const avatarUrl = body.avatarUrl === undefined ? null : profileImageValue(body.avatarUrl);
      const frame = body.avatarFrame === undefined ? null : avatarFrame(body.avatarFrame);
      if (displayName !== null && displayName.length < 2) {
        return sendJson(response, 400, { error: "Isim en az 2 karakter olmali" });
      }
      if (body.avatarUrl !== undefined && avatarUrl === null) {
        return sendJson(response, 400, { error: "Profil fotografi icin gecerli bir fotograf veya http/https baglantisi kullan" });
      }
      await query(
        `UPDATE users SET
           display_name = COALESCE($2, display_name),
           bio = COALESCE($3, bio),
           avatar_url = COALESCE($4, avatar_url),
           avatar_frame = COALESCE($5, avatar_frame)
         WHERE id = $1`,
        [user.id, displayName, bio, avatarUrl, frame]
      );
      const updated = await query(
        "SELECT id, email, display_name, handle, bio, avatar_url, avatar_frame, is_site_owner FROM users WHERE id = $1",
        [user.id]
      );
      return sendJson(response, 200, { user: updated.rows[0] });
    }

    const profileRoute = url.pathname.match(/^\/api\/users\/([0-9a-f-]+)$/i);
    if (method === "GET" && profileRoute) {
      const result = await query(
        `SELECT id, display_name, handle, bio, avatar_url, avatar_frame, is_site_owner, created_at
           FROM users WHERE id = $1`,
        [profileRoute[1]]
      );
      if (!result.rowCount) return sendJson(response, 404, { error: "Profil bulunamadi" });
      const [friendship, sharedServers] = await Promise.all([
        query(
          `SELECT status FROM friendships
            WHERE (requester_id = $1 AND addressee_id = $2)
               OR (requester_id = $2 AND addressee_id = $1)`,
          [user.id, profileRoute[1]]
        ),
        query(
          `SELECT s.id, s.name
             FROM memberships mine
             JOIN memberships theirs ON theirs.server_id = mine.server_id
             JOIN servers s ON s.id = mine.server_id
            WHERE mine.user_id = $1 AND theirs.user_id = $2
            ORDER BY s.name LIMIT 6`,
          [user.id, profileRoute[1]]
        )
      ]);
      return sendJson(response, 200, {
        profile: {
          ...result.rows[0],
          friendship: friendship.rows[0]?.status || null,
          sharedServers: sharedServers.rows
        }
      });
    }

    if (method === "GET" && url.pathname === "/api/friends") {
      const [friends, incoming, outgoing] = await Promise.all([
        query(
          `SELECT u.id, u.display_name, u.handle, u.bio, u.avatar_url, u.avatar_frame, u.is_site_owner, cp.nickname
             FROM friendships f
             JOIN users u ON u.id = CASE
               WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
             LEFT JOIN contact_preferences cp ON cp.user_id = $1 AND cp.contact_id = u.id
            WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
            ORDER BY u.display_name`,
          [user.id]
        ),
        query(
          `SELECT u.id, u.display_name, u.handle, u.bio, u.avatar_url, u.avatar_frame, u.is_site_owner, f.created_at
             FROM friendships f JOIN users u ON u.id = f.requester_id
            WHERE f.addressee_id = $1 AND f.status = 'pending' ORDER BY f.created_at DESC`,
          [user.id]
        ),
        query(
          `SELECT u.id, u.display_name, u.handle, u.bio, u.avatar_url, u.avatar_frame, f.created_at
             FROM friendships f JOIN users u ON u.id = f.addressee_id
            WHERE f.requester_id = $1 AND f.status = 'pending' ORDER BY f.created_at DESC`,
          [user.id]
        )
      ]);
      return sendJson(response, 200, {
        friends: friends.rows,
        incoming: incoming.rows,
        outgoing: outgoing.rows
      });
    }

    if (method === "GET" && url.pathname === "/api/notifications/summary") {
      const friendRequests = await query(
        "SELECT COUNT(*)::int AS count FROM friendships WHERE addressee_id = $1 AND status = 'pending'",
        [user.id]
      );
      const total = Number(friendRequests.rows[0]?.count || 0);
      return sendJson(response, 200, {
        notifications: {
          friendRequests: total,
          total
        }
      });
    }

    if (method === "POST" && url.pathname === "/api/friends/requests") {
      const body = await readJson(request);
      const handle = text(body.handle, 30).replace(/^@/, "").toLowerCase();
      const targetResult = await query(
        "SELECT id, display_name, handle, bio, avatar_url, avatar_frame FROM users WHERE LOWER(handle) = $1",
        [handle]
      );
      const target = targetResult.rows[0];
      if (!target) return sendJson(response, 404, { error: "Kullanıcı bulunamadı" });
      if (target.id === user.id) return sendJson(response, 400, { error: "Kendine arkadaşlık isteği gönderemezsin" });
      if(await isBlocked(user.id,target.id))return sendJson(response,403,{error:'Bu kullanıcıyla iletişim engellendi.'});
      const existing = await query(
        `SELECT requester_id, addressee_id, status FROM friendships
          WHERE (requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1)`,
        [user.id, target.id]
      );
      if (existing.rowCount) {
        const friendship = existing.rows[0];
        if (friendship.status === "accepted") {
          return sendJson(response, 409, { error: "Bu kullanıcı zaten arkadaşın" });
        }
        if (friendship.requester_id === target.id) {
          await query(
            `UPDATE friendships SET status = 'accepted', updated_at = NOW()
              WHERE requester_id = $1 AND addressee_id = $2`,
            [target.id, user.id]
          );
          return sendJson(response, 200, { accepted: true, friend: target });
        }
        return sendJson(response, 409, { error: "Arkadaşlık isteği zaten gönderildi" });
      }
      await query(
        "INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')",
        [user.id, target.id]
      );
      return sendJson(response, 201, { request: target });
    }

    const friendRequestRoute = url.pathname.match(/^\/api\/friends\/requests\/([0-9a-f-]+)$/i);
    if (method === "PATCH" && friendRequestRoute) {
      const body = await readJson(request);
      const requesterId = friendRequestRoute[1];
      if(body.action==='accept'&&await isBlocked(user.id,requesterId))return sendJson(response,403,{error:'Bu kullanıcıyla iletişim engellendi.'});
      if (body.action === "accept") {
        const result = await query(
          `UPDATE friendships SET status = 'accepted', updated_at = NOW()
            WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
          [requesterId, user.id]
        );
        if (!result.rowCount) return sendJson(response, 404, { error: "Arkadaşlık isteği bulunamadı" });
        return sendJson(response, 200, { ok: true });
      }
      if (body.action === "reject") {
        const result = await query(
          "DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'",
          [requesterId, user.id]
        );
        if (!result.rowCount) return sendJson(response, 404, { error: "Arkadaşlık isteği bulunamadı" });
        return sendJson(response, 200, { ok: true });
      }
      return sendJson(response, 400, { error: "Geçersiz arkadaşlık işlemi" });
    }

    const friendRoute = url.pathname.match(/^\/api\/friends\/([0-9a-f-]+)$/i);
    if (method === "DELETE" && friendRoute) {
      await query(
        `DELETE FROM friendships
          WHERE (requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1)`,
        [user.id, friendRoute[1]]
      );
      return sendJson(response, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/dms") {
      const result = await query(`SELECT u.id, u.display_name, u.handle, u.avatar_url, u.avatar_frame,
        cp.nickname, cp.pinned,
        (SELECT MAX(dm.created_at) FROM direct_messages dm WHERE (dm.sender_id=$1 AND dm.recipient_id=u.id) OR (dm.sender_id=u.id AND dm.recipient_id=$1)) AS last_message_at,
        (SELECT dm.content FROM direct_messages dm WHERE (dm.sender_id=$1 AND dm.recipient_id=u.id) OR (dm.sender_id=u.id AND dm.recipient_id=$1) ORDER BY dm.created_at DESC, dm.id DESC LIMIT 1) AS last_message,
        (SELECT COUNT(*) FROM direct_messages dm WHERE dm.sender_id=u.id AND dm.recipient_id=$1 AND (cp.read_at IS NULL OR dm.created_at > cp.read_at)) AS unread_count
        FROM users u LEFT JOIN contact_preferences cp ON cp.user_id=$1 AND cp.contact_id=u.id
        WHERE u.id <> $1 AND (EXISTS (SELECT 1 FROM direct_messages dm WHERE (dm.sender_id=$1 AND dm.recipient_id=u.id) OR (dm.sender_id=u.id AND dm.recipient_id=$1)) OR cp.pinned = $2)
        ORDER BY COALESCE(cp.pinned,$3) DESC, last_message_at DESC, u.display_name`, [user.id, true, false]);
      return sendJson(response, 200, { conversations: result.rows });
    }
    const contactRoute = url.pathname.match(/^\/api\/contacts\/([0-9a-f-]+)$/i);
    if (method === "PATCH" && contactRoute) {
      const contactId = contactRoute[1];
      const history = await query("SELECT id FROM direct_messages WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1) LIMIT 1", [user.id, contactId]);
      if (!(await areFriends(user.id, contactId)) && !history.rowCount) return sendJson(response, 403, { error: "Kişiye erişim yok" });
      const body = await readJson(request);
      await query("INSERT INTO contact_preferences (user_id,contact_id) VALUES ($1,$2) ON CONFLICT(user_id,contact_id) DO NOTHING", [user.id, contactId]);
      if (Object.hasOwn(body, "nickname")) await query("UPDATE contact_preferences SET nickname=$3 WHERE user_id=$1 AND contact_id=$2", [user.id, contactId, text(body.nickname, 60)]);
      if (typeof body.pinned === "boolean") await query("UPDATE contact_preferences SET pinned=$3 WHERE user_id=$1 AND contact_id=$2", [user.id, contactId, body.pinned]);
      if (body.read === true) await query("UPDATE contact_preferences SET read_at=NOW() WHERE user_id=$1 AND contact_id=$2", [user.id, contactId]);
      return sendJson(response, 200, { ok: true });
    }
    const mediaRoute = url.pathname.match(/^\/api\/dm-attachments\/([0-9a-f-]+)$/i);
    if (mediaRoute && ["GET", "HEAD"].includes(method)) {
      const result = await query(`SELECT a.* FROM dm_attachments a JOIN direct_messages dm ON dm.id=a.message_id WHERE a.id=$1 AND (dm.sender_id=$2 OR dm.recipient_id=$2)`, [mediaRoute[1], user.id]);
      if (!result.rowCount) return sendJson(response,404,{error:"Dosya bulunamadı"});
      const attachment=result.rows[0], bytes=Buffer.from(attachment.data), range=mediaRange(request.headers.range,bytes.length);
      response.setHeader("Cache-Control","private, no-store");
      response.setHeader("Accept-Ranges","bytes");
      if(!range){response.writeHead(416,{"Content-Range":`bytes */${bytes.length}`});return response.end();}
      response.setHeader("Content-Type",attachment.mime_type);
      response.setHeader("Content-Disposition",`${attachment.mime_type.startsWith('application/')||attachment.mime_type==='text/plain'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/'/g,"%27")}`);
      response.setHeader("Content-Length",range.end-range.start+1);
      if(range.partial)response.setHeader("Content-Range",`bytes ${range.start}-${range.end}/${bytes.length}`);
      response.writeHead(range.partial?206:200);
      return response.end(method==="HEAD"?undefined:bytes.subarray(range.start,range.end+1));
    }
    const dmRoute = url.pathname.match(/^\/api\/dms\/([0-9a-f-]+)$/i);
    if (dmRoute && ["GET", "POST"].includes(method)) {
      const friendId = dmRoute[1];
      if(method==='POST'&&await isBlocked(user.id,friendId))return sendJson(response,403,{error:'Bu kullanıcıyla iletişim engellendi.'});
      if (!(await areFriends(user.id, friendId))) {
        const history = method === "GET" && await query("SELECT id FROM direct_messages WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1) LIMIT 1", [user.id, friendId]);
        if (!history || !history.rowCount) return sendJson(response, 403, { error: "Yeni mesaj için önce arkadaş olmalısınız" });
      }
      if (method === "GET") {
        const result = await query(
          `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.content, dm.created_at,
                  u.display_name AS sender_name, u.handle AS sender_handle,
                  a.id AS attachment_id, a.name AS attachment_name, a.mime_type AS attachment_mime, a.size_bytes AS attachment_size
             FROM direct_messages dm JOIN users u ON u.id = dm.sender_id LEFT JOIN dm_attachments a ON a.message_id=dm.id
            WHERE ((dm.sender_id = $1 AND dm.recipient_id = $2)
               OR (dm.sender_id = $2 AND dm.recipient_id = $1))
              AND (dm.created_at < COALESCE($3,dm.created_at) OR ($3 IS NULL) OR (dm.created_at = $3 AND dm.id < $4))
            ORDER BY dm.created_at DESC, dm.id DESC LIMIT 101`,
          [user.id, friendId, url.searchParams.get("before") || null, url.searchParams.get("beforeId") || null]
        );
        const receipt=await query("SELECT read_at FROM contact_preferences WHERE user_id=$1 AND contact_id=$2",[friendId,user.id]);
        return sendJson(response, 200, { messages: result.rows.slice(0,100).reverse(), hasMore: result.rows.length > 100, peerOnline:Date.now()-(activeUsers.get(friendId)||0)<40000, peerReadAt:receipt.rows[0]?.read_at||null });
      }
      const body = await readJson(request,12*1024*1024);
      let attachment;
      try { attachment=validateDmAttachment(body.attachment); await enforceMediaDuration(attachment); } catch(error) { return sendJson(response,error.statusCode||400,{error:error.message}); }
      const content = text(body.content, 4000) || (attachment ? attachment.mime==='image/gif'?"[GIF]":attachment.mime.startsWith("image/")?"[Fotoğraf]":attachment.mime.startsWith("audio/")?"[Ses kaydı]":attachment.mime.startsWith('video/')?"[Video]":"[Dosya]" : "");
      if (!content) return sendJson(response, 400, { error: "Mesaj boş olamaz" });
      const message = { id: crypto.randomUUID(), content };
      await transaction(async client=>{
        if(attachment){
          if(process.env.DATABASE_URL)await client.query("SELECT pg_advisory_xact_lock(794112119)");
          const quota=await client.query("SELECT COALESCE(SUM(size_bytes),0) AS total, COALESCE(SUM(CASE WHEN owner_id=$1 THEN size_bytes ELSE 0 END),0) AS personal FROM dm_attachments",[user.id]);
          if(Number(quota.rows[0].total)+attachment.size>128*1024*1024 || Number(quota.rows[0].personal)+attachment.size>32*1024*1024)throw Object.assign(new Error("Media quota exceeded"),{statusCode:400,publicMessage:"Medya depolama sınırına ulaşıldı. Yazılı mesaj gönderebilirsin."});
        }
        await client.query(
        "INSERT INTO direct_messages (id, sender_id, recipient_id, content) VALUES ($1, $2, $3, $4)",
        [message.id, user.id, friendId, content]
        );
        if(attachment){
          const id=crypto.randomUUID();
          await client.query("INSERT INTO dm_attachments (id,message_id,owner_id,name,mime_type,size_bytes,data) VALUES ($1,$2,$3,$4,$5,$6,$7)",[id,message.id,user.id,attachment.name,attachment.mime,attachment.size,attachment.bytes]);
          Object.assign(message,{attachment_id:id,attachment_name:attachment.name,attachment_mime:attachment.mime,attachment_size:attachment.size});
        }
      });
      return sendJson(response, 201, {
        message: {
          ...message,
          sender_id: user.id,
          recipient_id: friendId,
          sender_name: user.display_name,
          created_at: new Date().toISOString()
        }
      });
    }

    if (method === "GET" && url.pathname === "/api/message-requests") {
      const result = await query(
        `SELECT mr.id, mr.sender_id, mr.recipient_id, mr.content, mr.created_at,
                u.display_name AS sender_name, u.handle AS sender_handle, u.avatar_url, u.avatar_frame
           FROM message_requests mr
           JOIN users u ON u.id = mr.sender_id
          WHERE mr.recipient_id = $1 AND mr.status = 'pending'
          ORDER BY mr.created_at DESC LIMIT 50`,
        [user.id]
      );
      return sendJson(response, 200, { requests: result.rows });
    }

    if (method === "POST" && url.pathname === "/api/message-requests") {
      const body = await readJson(request);
      const handle = text(body.handle, 30).replace(/^@/, "").toLowerCase();
      const content = text(body.content, 4000);
      if (!handle || !content) return sendJson(response, 400, { error: "Kullanici ve mesaj gerekli" });
      const targetResult = await query(
        "SELECT id FROM users WHERE LOWER(handle) = $1",
        [handle]
      );
      const target = targetResult.rows[0];
      if (!target || target.id === user.id) return sendJson(response, 404, { error: "Kullanici bulunamadi" });
      if(await isBlocked(user.id,target.id))return sendJson(response,403,{error:'Bu kullanıcıyla iletişim engellendi.'});
      if (await areFriends(user.id, target.id)) {
        return sendJson(response, 409, { error: "Bu kisi zaten arkadasin. DM kullan." });
      }
      await query(
        "INSERT INTO message_requests (id, sender_id, recipient_id, content) VALUES ($1, $2, $3, $4)",
        [crypto.randomUUID(), user.id, target.id, content]
      );
      return sendJson(response, 201, { ok: true });
    }

    const messageRequestRoute = url.pathname.match(/^\/api\/message-requests\/([0-9a-f-]+)$/i);
    if (method === "PATCH" && messageRequestRoute) {
      const body = await readJson(request);
      const requestId = messageRequestRoute[1];
      const requestResult = await query(
        "SELECT * FROM message_requests WHERE id = $1 AND recipient_id = $2 AND status = 'pending'",
        [requestId, user.id]
      );
      const messageRequest = requestResult.rows[0];
      if (!messageRequest) return sendJson(response, 404, { error: "Mesaj istegi bulunamadi" });
      if(body.action==='accept'&&await isBlocked(user.id,messageRequest.sender_id))return sendJson(response,403,{error:'Bu kullanıcıyla iletişim engellendi.'});
      if (body.action === "reject") {
        await query(
          "UPDATE message_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1",
          [requestId]
        );
        return sendJson(response, 200, { ok: true });
      }
      if (body.action !== "accept") return sendJson(response, 400, { error: "Gecersiz islem" });
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO friendships (requester_id, addressee_id, status)
           VALUES ($1, $2, 'accepted')
           ON CONFLICT(requester_id, addressee_id) DO UPDATE SET status = 'accepted', updated_at = NOW()`,
          [messageRequest.sender_id, user.id]
        );
        await client.query(
          "INSERT INTO direct_messages (id, sender_id, recipient_id, content) VALUES ($1, $2, $3, $4)",
          [crypto.randomUUID(), messageRequest.sender_id, user.id, messageRequest.content]
        );
        await client.query(
          "UPDATE message_requests SET status = 'accepted', updated_at = NOW() WHERE id = $1",
          [requestId]
        );
      });
      return sendJson(response, 200, { ok: true, friendId: messageRequest.sender_id });
    }

    if (method === "GET" && url.pathname === "/api/streams") {
      const result = await query(
        `SELECT ss.id, ss.title, ss.visibility, ss.status, ss.started_at, ss.server_id,
                ss.viewer_count::int AS viewer_count,
                u.id AS user_id, u.display_name, u.handle, u.avatar_url, u.avatar_frame,
                s.name AS server_name, s.logo_url AS server_logo_url, s.icon_color AS server_icon_color
           FROM stream_sessions ss
           JOIN users u ON u.id = ss.user_id
           LEFT JOIN servers s ON s.id = ss.server_id
          WHERE ss.status = 'live'
            AND (
              ss.visibility = 'global'
              OR ss.user_id = $1
              OR (ss.visibility = 'friends' AND EXISTS (
                SELECT 1 FROM friendships f
                 WHERE f.status = 'accepted'
                   AND ((f.requester_id = $1 AND f.addressee_id = ss.user_id)
                     OR (f.requester_id = ss.user_id AND f.addressee_id = $1))
              ))
              OR (ss.visibility = 'server' AND ss.server_id IN (
                SELECT server_id FROM memberships WHERE user_id = $1
              ))
            )
          ORDER BY CASE WHEN ss.visibility = 'global' THEN ss.viewer_count ELSE 0 END DESC,
                   ss.started_at DESC
          LIMIT 80`,
        [user.id]
      );
      const streams = { friends: [], servers: [], global: [] };
      for (const stream of result.rows) {
        if (stream.visibility === "friends") streams.friends.push(stream);
        else if (stream.visibility === "server") streams.servers.push(stream);
        else streams.global.push(stream);
      }
      return sendJson(response, 200, { streams });
    }

    if (method === "POST" && url.pathname === "/api/streams") {
      const body = await readJson(request);
      const serverId = text(body.serverId, 80) || null;
      const visibility = streamVisibility(body.visibility);
      const title = text(body.title, 80) || "YAAS yayini";
      if (serverId) {
        const granted = await requirePermission(response, sendJson, serverId, user.id, "streams.create");
        if (!granted) return;
      }
      if (!serverId && visibility === "server") {
        return sendJson(response, 400, { error: "Sunucu yayini icin sunucu secmelisin" });
      }
      const id = crypto.randomUUID();
      await query(
        `INSERT INTO stream_sessions (id, user_id, server_id, title, visibility)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, user.id, serverId, title, visibility]
      );
      return sendJson(response, 201, { stream: { id, title, visibility, server_id: serverId, user_id: user.id } });
    }

    const streamViewerRoute = url.pathname.match(/^\/api\/streams\/([0-9a-f-]+)\/viewers$/i);
    if (method === "POST" && streamViewerRoute) {
      const stream = await visibleStream(streamViewerRoute[1], user.id);
      if (!stream) return sendJson(response, 404, { error: "Yayin bulunamadi" });
      await query(
        `INSERT INTO stream_viewers (stream_id, user_id, last_seen)
         VALUES ($1, $2, NOW())
         ON CONFLICT(stream_id, user_id) DO UPDATE SET last_seen = NOW()`,
        [stream.id, user.id]
      );
      stream.viewer_count = await refreshStreamViewerCount(stream.id);
      return sendJson(response, 200, { stream });
    }

    const streamViewerLeaveRoute = url.pathname.match(/^\/api\/streams\/([0-9a-f-]+)\/viewers\/me$/i);
    if (method === "DELETE" && streamViewerLeaveRoute) {
      await query(
        "DELETE FROM stream_viewers WHERE stream_id = $1 AND user_id = $2",
        [streamViewerLeaveRoute[1], user.id]
      );
      const viewerCount = await refreshStreamViewerCount(streamViewerLeaveRoute[1]);
      return sendJson(response, 200, { ok: true, viewer_count: viewerCount });
    }

    const streamRoute = url.pathname.match(/^\/api\/streams\/([0-9a-f-]+)$/i);
    if (method === "GET" && streamRoute) {
      const stream = await visibleStream(streamRoute[1], user.id);
      if (!stream) return sendJson(response, 404, { error: "Yayin bulunamadi" });
      return sendJson(response, 200, { stream });
    }

    if (method === "DELETE" && streamRoute) {
      await transaction(async (client) => {
        const ended = await client.query(
          "UPDATE stream_sessions SET status = 'ended', viewer_count = 0, ended_at = NOW() WHERE id = $1 AND user_id = $2",
          [streamRoute[1], user.id]
        );
        if (ended.rowCount) {
          await client.query("DELETE FROM stream_viewers WHERE stream_id = $1", [streamRoute[1]]);
        }
      });
      return sendJson(response, 200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/servers") {
      const result = await query(
        `SELECT s.id, s.name, s.description, s.icon_color, s.logo_url, s.owner_id, m.joined_at,
                COUNT(m2.user_id)::int AS member_count
           FROM memberships m
           JOIN servers s ON s.id = m.server_id
           JOIN memberships m2 ON m2.server_id = s.id
          WHERE m.user_id = $1
          GROUP BY s.id, m.joined_at ORDER BY m.joined_at DESC`,
        [user.id]
      );
      return sendJson(response, 200, { servers: result.rows });
    }

    if (method === "POST" && url.pathname === "/api/servers") {
      const body = await readJson(request);
      if (text(body.name, 40).length < 2) return sendJson(response, 400, { error: "Sunucu adı gerekli" });
      try {
        return sendJson(response, 201, { server: await transaction((client) => createServer(client, user, body)) });
      } catch (error) {
        if (error.statusCode) return sendJson(response, error.statusCode, { error: error.message });
        throw error;
      }
    }

    const serverRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)$/i);
    if (method === "PATCH" && serverRoute) {
      const serverId = serverRoute[1];
      if (!(await requirePermission(response, sendJson, serverId, user.id, "server.manage"))) return;
      const body = await readJson(request);
      const name = body.name === undefined ? null : text(body.name, 40);
      const iconColor = body.iconColor === undefined ? null : text(body.iconColor, 20);
      const hasLogoUrl = Object.prototype.hasOwnProperty.call(body, "logoUrl");
      const logoUrl = hasLogoUrl ? profileImageValue(body.logoUrl) : null;
      if (body.name !== undefined && name.length < 2) {
        return sendJson(response, 400, { error: "Sunucu adı en az 2 karakter olmalı" });
      }
      if (iconColor !== null && !/^#[0-9a-f]{6}$/i.test(iconColor)) {
        return sendJson(response, 400, { error: "Geçerli bir simge rengi seçmelisin" });
      }
      if (hasLogoUrl && logoUrl === null) {
        return sendJson(response, 400, { error: "Sunucu logosu icin gecerli bir gorsel baglantisi kullanmalisin" });
      }
      await query(
        `UPDATE servers SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           icon_color = COALESCE($4, icon_color),
           logo_url = CASE WHEN $5 THEN $6 ELSE logo_url END
         WHERE id = $1`,
        [
          serverId,
          name,
          body.description === undefined ? null : text(body.description, 180),
          iconColor,
          hasLogoUrl,
          logoUrl
        ]
      );
      return sendJson(response, 200, { ok: true, server: await serverSummary(serverId) });
    }
    if (method === "DELETE" && serverRoute) {
      const serverId = serverRoute[1];
      const owned = await query("SELECT id FROM servers WHERE id = $1 AND owner_id = $2", [serverId, user.id]);
      if (!owned.rowCount) return sendJson(response, 403, { error: "Yalnızca sunucu sahibi sunucuyu silebilir" });
      await recordAdminAudit({ request, actorUserId: user.id, action: "server_delete", targetType: "server", targetId: serverId });
      await query("DELETE FROM servers WHERE id = $1", [serverId]);
      return sendJson(response, 200, { ok: true });
    }

    const transferOwnerRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/transfer-owner$/i);
    if (method === "POST" && transferOwnerRoute) {
      const serverId = transferOwnerRoute[1];
      const body = await readJson(request);
      const newOwnerId = text(body.newOwnerId, 80);
      const server = await query("SELECT owner_id FROM servers WHERE id = $1", [serverId]);
      if (!server.rowCount) return sendJson(response, 404, { error: "Sunucu bulunamadi" });
      if (server.rows[0].owner_id !== user.id) {
        return sendJson(response, 403, { error: "Yalnizca sunucu sahibi sahipligi devredebilir" });
      }
      if (!newOwnerId || newOwnerId === user.id) {
        return sendJson(response, 400, { error: "Yeni sahip farkli bir uye olmali" });
      }
      const target = await query(
        "SELECT user_id FROM memberships WHERE server_id = $1 AND user_id = $2",
        [serverId, newOwnerId]
      );
      if (!target.rowCount) return sendJson(response, 404, { error: "Yeni sahip bu sunucuda uye degil" });
      await transaction(async (client) => {
        await client.query("UPDATE servers SET owner_id = $2 WHERE id = $1", [serverId, newOwnerId]);
        const ownerRole = await client.query(
          "SELECT id FROM roles WHERE server_id = $1 AND name = 'Owner' LIMIT 1",
          [serverId]
        );
        const ownerRoleId = ownerRole.rows[0]?.id;
        if (ownerRoleId) {
          await client.query(
            "DELETE FROM member_roles WHERE server_id = $1 AND role_id = $2",
            [serverId, ownerRoleId]
          );
          await client.query(
            "INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [serverId, newOwnerId, ownerRoleId]
          );
        }
      });
      await recordAdminAudit({ request, actorUserId: user.id, action: "server_owner_transfer", targetType: "server", targetId: serverId, metadata: { newOwnerId } });
      return sendJson(response, 200, { ok: true });
    }

    const leaveServerRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/members\/me$/i);
    if (method === "DELETE" && leaveServerRoute) {
      const serverId = leaveServerRoute[1];
      const server = await query("SELECT owner_id FROM servers WHERE id = $1", [serverId]);
      if (!server.rowCount || !(await membership(serverId, user.id))) {
        return sendJson(response, 404, { error: "Sunucu bulunamadı" });
      }
      if (server.rows[0].owner_id === user.id) {
        return sendJson(response, 403, { error: "Sunucu sahibi sunucudan ayrılamaz; önce sunucuyu silmelisin" });
      }
      await query("DELETE FROM memberships WHERE server_id = $1 AND user_id = $2", [serverId, user.id]);
      return sendJson(response, 200, { ok: true });
    }

    if (method === "GET" && serverRoute) {
      const serverId = serverRoute[1];
      await ensureStreamerRole(serverId);
      const granted = await permissions(serverId, user.id);
      if (!granted) return sendJson(response, 404, { error: "Sunucu bulunamadı" });
      const [server, categories, channels, members, memberRoles, roles] = await Promise.all([
        query("SELECT id, name, description, icon_color, logo_url, owner_id, created_at FROM servers WHERE id = $1", [serverId]),
        query("SELECT id, name, position FROM channel_categories WHERE server_id = $1 ORDER BY position", [serverId]),
        query("SELECT id, category_id, name, type, position, is_private, allowed_role_ids, user_limit, audio_bitrate, quality_mode FROM channels WHERE server_id = $1 ORDER BY position", [serverId]),
        query(
          `SELECT u.id, u.display_name, u.handle, u.bio, u.avatar_url, u.avatar_frame, u.is_site_owner, m.nickname, m.joined_at
             FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.server_id = $1 ORDER BY m.joined_at`,
          [serverId]
        ),
        query(
          `SELECT mr.user_id, r.id, r.name, r.color, r.role_icon, r.role_hoist, r.position
             FROM member_roles mr JOIN roles r ON r.id = mr.role_id
            WHERE mr.server_id = $1 ORDER BY r.position DESC`,
          [serverId]
        ),
        query("SELECT id, name, color, role_icon, role_hoist, position, permissions, is_system FROM roles WHERE server_id = $1 ORDER BY position DESC", [serverId])
      ]);
      const rolesByMember = new Map();
      for (const role of memberRoles.rows) {
        if (!rolesByMember.has(role.user_id)) rolesByMember.set(role.user_id, []);
        rolesByMember.get(role.user_id).push({
          id: role.id,
          name: role.name,
          color: role.color,
          role_icon: role.role_icon,
          role_hoist: role.role_hoist,
          position: role.position
        });
      }
      const normalizedMembers = members.rows.map((member) => ({
        ...member,
        roles: rolesByMember.get(member.id) || []
      }));
      const normalizedChannels = channels.rows.map((channel) => ({
        ...channel,
        allowed_role_ids: jsonArray(channel.allowed_role_ids)
      }));
      const normalizedRoles = roles.rows.map((role) => ({
        ...role,
        permissions: jsonArray(role.permissions)
      }));
      const currentMember = normalizedMembers.find((item) => item.id === user.id);
      const roleIds = new Set((currentMember?.roles || []).map((role) => role.id));
      const isOwner = server.rows[0]?.owner_id === user.id;
      const visibleChannels = normalizedChannels.filter((channel) =>
        isOwner || !channel.is_private || channel.allowed_role_ids.some((roleId) => roleIds.has(roleId))
      );
      return sendJson(response, 200, {
        server: server.rows[0],
        categories: categories.rows,
        channels: visibleChannels,
        members: normalizedMembers,
        roles: (granted.has("roles.manage") || granted.has("channels.manage") || granted.has("members.manage")) ? normalizedRoles : [],
        permissions: [...granted]
      });
    }

    const roleRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/roles$/i);
    if (method === "POST" && roleRoute) {
      const serverId = roleRoute[1];
      if (!(await requirePermission(response, sendJson, serverId, user.id, "roles.manage"))) return;
      const body = await readJson(request);
      const actorPosition = await highestRolePosition(serverId, user.id);
      const requestedPosition = Number(body.position) || 20;
      const role = {
        id: crypto.randomUUID(),
        name: text(body.name, 30),
        role_icon: "",
        role_hoist: Boolean(body.roleHoist),
        permissions: validPermissions(body.permissions),
        position: Number.isFinite(actorPosition) ? Math.min(requestedPosition, actorPosition - 1) : requestedPosition
      };
      if (!role.name) return sendJson(response, 400, { error: "Rol adı gerekli" });
      role.role_icon = roleIconValue(body.roleIcon, role.name);
      await query(
        `INSERT INTO roles (id, server_id, name, color, role_icon, role_hoist, position, permissions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [role.id, serverId, role.name, text(body.color, 20) || "#8d7aff", role.role_icon, role.role_hoist, role.position, JSON.stringify(role.permissions)]
      );
      await recordAdminAudit({ request, actorUserId: user.id, action: "role_create", targetType: "role", targetId: role.id, metadata: { serverId, name: role.name } });
      return sendJson(response, 201, { role });
    }

    const roleItemRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/roles\/([0-9a-f-]+)$/i);
    if (roleItemRoute && ["PATCH", "DELETE"].includes(method)) {
      const [, serverId, roleId] = roleItemRoute;
      if (!(await requirePermission(response, sendJson, serverId, user.id, "roles.manage"))) return;
      const existing = await query("SELECT id, name, position, is_system FROM roles WHERE id = $1 AND server_id = $2", [roleId, serverId]);
      const role = existing.rows[0];
      if (!role) return sendJson(response, 404, { error: "Rol bulunamadı" });
      if (role.name === "Owner") return sendJson(response, 403, { error: "Owner rolü değiştirilemez" });
      const actorPosition = await highestRolePosition(serverId, user.id);
      if (Number.isFinite(actorPosition) && role.position >= actorPosition) {
        return sendJson(response, 403, { error: "Kendi rolüne eşit veya yüksek bir rolü yönetemezsin" });
      }
      if (method === "DELETE") {
        if (role.is_system) return sendJson(response, 403, { error: "Sistem rolü silinemez" });
        await query("DELETE FROM roles WHERE id = $1 AND server_id = $2", [roleId, serverId]);
        await recordAdminAudit({ request, actorUserId: user.id, action: "role_delete", targetType: "role", targetId: roleId, metadata: { serverId } });
        return sendJson(response, 200, { ok: true });
      }
      const body = await readJson(request);
      await query(
        `UPDATE roles SET
           name = COALESCE($3, name),
           color = COALESCE($4, color),
           position = COALESCE($5, position),
           permissions = COALESCE($6::jsonb, permissions),
           role_icon = COALESCE($7, role_icon),
           role_hoist = COALESCE($8, role_hoist)
         WHERE id = $1 AND server_id = $2`,
        [
          roleId,
          serverId,
          body.name ? text(body.name, 30) : null,
          body.color ? text(body.color, 20) : null,
          Number.isFinite(Number(body.position))
            ? (Number.isFinite(actorPosition) ? Math.min(Number(body.position), actorPosition - 1) : Number(body.position))
            : null,
          Array.isArray(body.permissions) ? JSON.stringify(validPermissions(body.permissions)) : null,
          body.roleIcon !== undefined ? roleIconValue(body.roleIcon, body.name || role.name) : null,
          body.roleHoist !== undefined ? Boolean(body.roleHoist) : null
        ]
      );
      await recordAdminAudit({ request, actorUserId: user.id, action: "role_update", targetType: "role", targetId: roleId, metadata: { serverId } });
      return sendJson(response, 200, { ok: true });
    }

    const assignRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/members\/([0-9a-f-]+)\/roles\/([0-9a-f-]+)$/i);
    if (method === "PUT" && assignRoute) {
      const [, serverId, memberId, roleId] = assignRoute;
      if (!(await requirePermission(response, sendJson, serverId, user.id, "members.manage"))) return;
      const role = await query("SELECT name, position FROM roles WHERE id = $1 AND server_id = $2", [roleId, serverId]);
      if (!role.rowCount) return sendJson(response, 404, { error: "Rol bulunamadı" });
      const actorPosition = await highestRolePosition(serverId, user.id);
      if (role.rows[0].name === "Owner" || (Number.isFinite(actorPosition) && role.rows[0].position >= actorPosition)) {
        return sendJson(response, 403, { error: "Bu rolü veremezsin" });
      }
      await query(
        `INSERT INTO member_roles (server_id, user_id, role_id)
         SELECT $1, $2, id FROM roles WHERE id = $3 AND server_id = $1 ON CONFLICT DO NOTHING`,
        [serverId, memberId, roleId]
      );
      await recordAdminAudit({ request, actorUserId: user.id, action: "member_role_assign", targetType: "member", targetId: memberId, metadata: { serverId, roleId } });
      return sendJson(response, 200, { ok: true });
    }
    if (method === "DELETE" && assignRoute) {
      const [, serverId, memberId, roleId] = assignRoute;
      if (!(await requirePermission(response, sendJson, serverId, user.id, "members.manage"))) return;
      const role = await query("SELECT name, position FROM roles WHERE id = $1 AND server_id = $2", [roleId, serverId]);
      if (role.rows[0]?.name === "Owner") return sendJson(response, 403, { error: "Owner rolü kaldırılamaz" });
      const actorPosition = await highestRolePosition(serverId, user.id);
      if (Number.isFinite(actorPosition) && role.rows[0]?.position >= actorPosition) {
        return sendJson(response, 403, { error: "Bu rolü kaldıramazsın" });
      }
      await query(
        "DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2 AND role_id = $3",
        [serverId, memberId, roleId]
      );
      await recordAdminAudit({ request, actorUserId: user.id, action: "member_role_remove", targetType: "member", targetId: memberId, metadata: { serverId, roleId } });
      return sendJson(response, 200, { ok: true });
    }

    const channelRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/channels$/i);
    if (method === "POST" && channelRoute) {
      const serverId = channelRoute[1];
      if (!(await requirePermission(response, sendJson, serverId, user.id, "channels.manage"))) return;
      const body = await readJson(request);
      const channel = { id: crypto.randomUUID(), name: text(body.name, 40), type: body.type === "voice" ? "voice" : "text" };
      if (!channel.name) return sendJson(response, 400, { error: "Kanal adı gerekli" });
      const categoryId = body.categoryId || null;
      if (categoryId) {
        const category = await query(
          "SELECT id FROM channel_categories WHERE id = $1 AND server_id = $2",
          [categoryId, serverId]
        );
        if (!category.rowCount) return sendJson(response, 400, { error: "Kategori bulunamadı" });
      }
      await query(
        `INSERT INTO channels
           (id, server_id, category_id, name, type, position, is_private, allowed_role_ids, user_limit, audio_bitrate, quality_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
        [
          channel.id,
          serverId,
          categoryId,
          channel.name,
          channel.type,
          Number(body.position) || 100,
          Boolean(body.isPrivate),
          JSON.stringify(body.allowedRoleIds || []),
          channel.type === "voice" ? boundedNumber(body.userLimit, 12, 0, 25) : 0,
          channel.type === "voice" ? boundedNumber(body.audioBitrate, 64, 32, 128) : 64,
          channel.type === "voice" ? qualityMode(body.qualityMode) : "auto"
        ]
      );
      return sendJson(response, 201, { channel });
    }

    const channelItemRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/channels\/([0-9a-f-]+)$/i);
    if (channelItemRoute && ["PATCH", "DELETE"].includes(method)) {
      const [, serverId, channelId] = channelItemRoute;
      if (!(await requirePermission(response, sendJson, serverId, user.id, "channels.manage"))) return;
      if (method === "DELETE") {
        await query("DELETE FROM channels WHERE id = $1 AND server_id = $2", [channelId, serverId]);
        return sendJson(response, 200, { ok: true });
      }
      const body = await readJson(request);
      await query(
        `UPDATE channels SET
           name = COALESCE($3, name),
           position = COALESCE($4, position),
           is_private = COALESCE($5, is_private),
           allowed_role_ids = COALESCE($6::jsonb, allowed_role_ids),
           category_id = CASE WHEN $8 THEN $7 ELSE category_id END,
           user_limit = COALESCE($9, user_limit),
           audio_bitrate = COALESCE($10, audio_bitrate),
           quality_mode = COALESCE($11, quality_mode)
         WHERE id = $1 AND server_id = $2`,
        [
          channelId,
          serverId,
          body.name ? text(body.name, 40) : null,
          Number.isFinite(Number(body.position)) ? Number(body.position) : null,
          typeof body.isPrivate === "boolean" ? body.isPrivate : null,
          Array.isArray(body.allowedRoleIds) ? JSON.stringify(body.allowedRoleIds) : null,
          body.categoryId || null,
          Object.hasOwn(body, "categoryId"),
          body.userLimit === undefined ? null : boundedNumber(body.userLimit, 12, 0, 25),
          body.audioBitrate === undefined ? null : boundedNumber(body.audioBitrate, 64, 32, 128),
          body.qualityMode === undefined ? null : qualityMode(body.qualityMode)
        ]
      );
      return sendJson(response, 200, { ok: true });
    }

    const categoryRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/categories$/i);
    if (method === "POST" && categoryRoute) {
      const serverId = categoryRoute[1];
      if (!(await requirePermission(response, sendJson, serverId, user.id, "channels.manage"))) return;
      const body = await readJson(request);
      const category = { id: crypto.randomUUID(), name: text(body.name, 40) };
      if (!category.name) return sendJson(response, 400, { error: "Kategori adı gerekli" });
      await query(
        "INSERT INTO channel_categories (id, server_id, name, position) VALUES ($1, $2, $3, $4)",
        [category.id, serverId, category.name, Number(body.position) || 100]
      );
      return sendJson(response, 201, { category });
    }

    const categoryItemRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/categories\/([0-9a-f-]+)$/i);
    if (method === "DELETE" && categoryItemRoute) {
      const [, serverId, categoryId] = categoryItemRoute;
      if (!(await requirePermission(response, sendJson, serverId, user.id, "channels.manage"))) return;
      await query("DELETE FROM channel_categories WHERE id = $1 AND server_id = $2", [categoryId, serverId]);
      return sendJson(response, 200, { ok: true });
    }

    const inviteRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/invites$/i);
    if (method === "GET" && inviteRoute) {
      const serverId = inviteRoute[1];
      if (!(await requirePermission(response, sendJson, serverId, user.id, "invites.create"))) return;
      const result = await query(
        `SELECT i.id, i.code, i.expires_at, i.max_uses, i.uses, i.created_at,
                u.display_name AS creator_name, u.handle AS creator_handle
           FROM invites i
           JOIN users u ON u.id = i.created_by
          WHERE i.server_id = $1
            AND (i.expires_at IS NULL OR i.expires_at > NOW())
            AND (i.max_uses IS NULL OR i.uses < i.max_uses)
          ORDER BY i.created_at DESC`,
        [serverId]
      );
      return sendJson(response, 200, {
        invites: result.rows.map((invite) => ({
          ...invite,
          url: `${getOrigin(request)}/invite/${invite.code}`
        }))
      });
    }

    if (method === "POST" && inviteRoute) {
      const serverId = inviteRoute[1];
      if (!(await requirePermission(response, sendJson, serverId, user.id, "invites.create"))) return;
      const body = await readJson(request);
      const code = crypto.randomBytes(6).toString("base64url");
      const expiresAt = body.expiresInHours ? new Date(Date.now() + Math.min(Number(body.expiresInHours), 720) * 3600_000) : null;
      await query(
        "INSERT INTO invites (id, server_id, code, created_by, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5, $6)",
        [crypto.randomUUID(), serverId, code, user.id, expiresAt, body.maxUses ? Math.min(Number(body.maxUses), 1000) : null]
      );
      return sendJson(response, 201, { invite: { code, url: `${getOrigin(request)}/invite/${code}` } });
    }

    const inviteItemRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)\/invites\/([0-9a-f-]+)$/i);
    if (method === "DELETE" && inviteItemRoute) {
      const [serverId, inviteId] = [inviteItemRoute[1], inviteItemRoute[2]];
      if (!(await requirePermission(response, sendJson, serverId, user.id, "invites.create"))) return;
      const result = await query(
        "DELETE FROM invites WHERE id = $1 AND server_id = $2",
        [inviteId, serverId]
      );
      if (!result.rowCount) return sendJson(response, 404, { error: "Davet bulunamadi" });
      return sendJson(response, 200, { ok: true });
    }

    const joinRoute = url.pathname.match(/^\/api\/invites\/([A-Za-z0-9_-]+)\/join$/);
    if (method === "POST" && joinRoute) {
      const serverId = await transaction(async (client) => {
        const result = await client.query(
          `SELECT * FROM invites WHERE code = $1 AND (expires_at IS NULL OR expires_at > NOW())
             AND (max_uses IS NULL OR uses < max_uses) FOR UPDATE`,
          [joinRoute[1]]
        );
        const invite = result.rows[0];
        if (!invite) return null;
        const existingMembership = await client.query(
          "SELECT 1 FROM memberships WHERE server_id = $1 AND user_id = $2",
          [invite.server_id, user.id]
        );
        if (existingMembership.rowCount) return invite.server_id;
        await client.query("INSERT INTO memberships (server_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [invite.server_id, user.id]);
        await client.query(
          `INSERT INTO member_roles (server_id, user_id, role_id)
           SELECT $1, $2, id FROM roles WHERE server_id = $1 AND name = 'Member' ON CONFLICT DO NOTHING`,
          [invite.server_id, user.id]
        );
        await client.query("UPDATE invites SET uses = uses + 1 WHERE id = $1", [invite.id]);
        return invite.server_id;
      });
      if (!serverId) return sendJson(response, 404, { error: "Davet geçersiz veya süresi dolmuş" });
      return sendJson(response, 200, { serverId });
    }

    const messageRoute = url.pathname.match(/^\/api\/channels\/([0-9a-f-]+)\/messages$/i);
    if (messageRoute) {
      const channelResult = await query("SELECT id, server_id, type, is_private, allowed_role_ids FROM channels WHERE id = $1", [messageRoute[1]]);
      const channel = channelResult.rows[0];
      if (!channel || !(await membership(channel.server_id, user.id))) return sendJson(response, 404, { error: "Kanal bulunamadı" });
      if (channel.is_private) {
        const serverOwner = await query("SELECT owner_id FROM servers WHERE id = $1", [channel.server_id]);
        if (serverOwner.rows[0]?.owner_id !== user.id) {
          const memberRoles = await query("SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2", [channel.server_id, user.id]);
          const allowedRoles = new Set(jsonArray(channel.allowed_role_ids));
          if (!memberRoles.rows.some(role => allowedRoles.has(role.role_id))) return sendJson(response, 404, { error: "Kanal bulunamadı" });
        }
      }
      if (channel.type !== "text") return sendJson(response, 400, { error: "Bu bir yazı kanalı değil" });
      if (method === "GET") {
        if (!(await requirePermission(response, sendJson, channel.server_id, user.id, "channel.view"))) return;
        const result = await query(
          `SELECT m.id, m.content, m.created_at, m.edited_at, u.id AS author_id,
                  u.display_name AS author_name, u.handle AS author_handle
             FROM messages m JOIN users u ON u.id = m.author_id
            WHERE m.channel_id = $1 ORDER BY m.created_at DESC LIMIT 100`,
          [channel.id]
        );
        return sendJson(response, 200, { messages: result.rows.reverse() });
      }
      if (method === "POST") {
        if (!(await requirePermission(response, sendJson, channel.server_id, user.id, "messages.send"))) return;
        const body = await readJson(request);
        const content = text(body.content, 4000);
        if (!content) return sendJson(response, 400, { error: "Mesaj boş olamaz" });
        const id = crypto.randomUUID();
        await query("INSERT INTO messages (id, channel_id, author_id, content) VALUES ($1, $2, $3, $4)", [id, channel.id, user.id, content]);
        return sendJson(response, 201, { message: { id, content, authorId: user.id, authorName: user.display_name } });
      }
    }

    sendJson(response, 404, { error: "API yolu bulunamadı" });
  } catch (error) {
    if(error.statusCode===503)return sendJson(response,503,{error:error.message});
    if (error.statusCode === 413) {
      return sendJson(response, 413, { error: "Istek cok buyuk" });
    }
    if (error.statusCode === 400) {
      return sendJson(response, 400, { error: error.publicMessage || "Gecersiz istek" });
    }
    if (error.code === "23505" || /UNIQUE constraint failed/i.test(error.message)) {
      return sendJson(response, 409, { error: "Bu kayıt zaten mevcut" });
    }
    console.error("API error", { code: String(error.code || "INTERNAL_ERROR").slice(0, 40) });
    recordSecurityEvent({ request, eventType: "server_error", severity: "high", metadata: { path: url.pathname, code: String(error.code || "INTERNAL_ERROR").slice(0, 40) } }).catch(() => {});
    sendJson(response, 500, { error: "Sunucu hatası" });
  }
}

module.exports = { handleApi };
