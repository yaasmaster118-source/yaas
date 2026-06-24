"use strict";

const crypto = require("crypto");
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

function text(value, max) {
  return String(value || "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return text(value, 254).toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
  await client.query(
    "INSERT INTO servers (id, name, description, icon_color, owner_id) VALUES ($1, $2, $3, $4, $5)",
    [serverId, text(body.name, 40), text(body.description, 180), iconColor, user.id]
  );
  await client.query("INSERT INTO memberships (server_id, user_id) VALUES ($1, $2)", [serverId, user.id]);
  const roles = {};
  for (const template of ROLE_TEMPLATES) {
    const roleId = crypto.randomUUID();
    roles[template.name] = roleId;
    await client.query(
      `INSERT INTO roles (id, server_id, name, color, position, permissions, is_system)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, TRUE)`,
      [roleId, serverId, template.name, template.color, template.position, JSON.stringify(template.permissions)]
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
  return { id: serverId, name: text(body.name, 40) };
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
        console.error(error);
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
      if (!validEmail(email) || name.length < 2 || !strongPassword(password)) {
        return sendJson(response, 400, { error: "Geçerli ad, e-posta ve en az 8 karakterli, harf ve rakam içeren şifre gerekli" });
      }
      if ((await query("SELECT 1 FROM users WHERE email = $1", [email])).rowCount) {
        return sendJson(response, 409, { error: "Bu e-posta zaten kayıtlı. Lütfen giriş yap." });
      }
      const user = { id: crypto.randomUUID(), email, name, handle: makeHandle(email) };
      const isSiteOwner = Boolean(process.env.OWNER_EMAIL)
        && email === process.env.OWNER_EMAIL.trim().toLowerCase();
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
        user: { id: user.id, email, displayName: name, handle: user.handle, is_site_owner: isSiteOwner }
      });
    }

    if (method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(request);
      const result = await query(
        "SELECT id, email, display_name, handle, password_hash, is_site_owner FROM users WHERE email = $1",
        [normalizeEmail(body.email)]
      );
      const user = result.rows[0];
      if (!user) {
        return sendJson(response, 404, { error: "Bu e-posta ile hesap bulunamadı. Önce hesap oluştur." });
      }
      if (!(await verifyPassword(String(body.password || ""), user.password_hash))) {
        return sendJson(response, 401, { error: "Şifre yanlış. Lütfen tekrar dene." });
      }
      await createSession(user.id, response);
      return sendJson(response, 200, {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          handle: user.handle,
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
    if (!user) return;

    if (method === "GET" && url.pathname === "/api/friends") {
      const [friends, incoming, outgoing] = await Promise.all([
        query(
          `SELECT u.id, u.display_name, u.handle, u.is_site_owner
             FROM friendships f
             JOIN users u ON u.id = CASE
               WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
            WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
            ORDER BY u.display_name`,
          [user.id]
        ),
        query(
          `SELECT u.id, u.display_name, u.handle, u.is_site_owner, f.created_at
             FROM friendships f JOIN users u ON u.id = f.requester_id
            WHERE f.addressee_id = $1 AND f.status = 'pending' ORDER BY f.created_at DESC`,
          [user.id]
        ),
        query(
          `SELECT u.id, u.display_name, u.handle, f.created_at
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

    if (method === "POST" && url.pathname === "/api/friends/requests") {
      const body = await readJson(request);
      const handle = text(body.handle, 30).replace(/^@/, "").toLowerCase();
      const targetResult = await query(
        "SELECT id, display_name, handle FROM users WHERE LOWER(handle) = $1",
        [handle]
      );
      const target = targetResult.rows[0];
      if (!target) return sendJson(response, 404, { error: "Kullanıcı bulunamadı" });
      if (target.id === user.id) return sendJson(response, 400, { error: "Kendine arkadaşlık isteği gönderemezsin" });
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

    const dmRoute = url.pathname.match(/^\/api\/dms\/([0-9a-f-]+)$/i);
    if (dmRoute && ["GET", "POST"].includes(method)) {
      const friendId = dmRoute[1];
      if (!(await areFriends(user.id, friendId))) {
        return sendJson(response, 403, { error: "Özel mesaj için önce arkadaş olmalısınız" });
      }
      if (method === "GET") {
        const result = await query(
          `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.content, dm.created_at,
                  u.display_name AS sender_name, u.handle AS sender_handle
             FROM direct_messages dm JOIN users u ON u.id = dm.sender_id
            WHERE (dm.sender_id = $1 AND dm.recipient_id = $2)
               OR (dm.sender_id = $2 AND dm.recipient_id = $1)
            ORDER BY dm.created_at DESC LIMIT 100`,
          [user.id, friendId]
        );
        return sendJson(response, 200, { messages: result.rows.reverse() });
      }
      const body = await readJson(request);
      const content = text(body.content, 4000);
      if (!content) return sendJson(response, 400, { error: "Mesaj boş olamaz" });
      const message = { id: crypto.randomUUID(), content };
      await query(
        "INSERT INTO direct_messages (id, sender_id, recipient_id, content) VALUES ($1, $2, $3, $4)",
        [message.id, user.id, friendId, content]
      );
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

    if (method === "GET" && url.pathname === "/api/servers") {
      const result = await query(
        `SELECT s.id, s.name, s.description, s.icon_color, s.owner_id, m.joined_at,
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
      return sendJson(response, 201, { server: await transaction((client) => createServer(client, user, body)) });
    }

    const serverRoute = url.pathname.match(/^\/api\/servers\/([0-9a-f-]+)$/i);
    if (method === "PATCH" && serverRoute) {
      const serverId = serverRoute[1];
      if (!(await requirePermission(response, sendJson, serverId, user.id, "server.manage"))) return;
      const body = await readJson(request);
      const name = body.name === undefined ? null : text(body.name, 40);
      const iconColor = body.iconColor === undefined ? null : text(body.iconColor, 20);
      if (body.name !== undefined && name.length < 2) {
        return sendJson(response, 400, { error: "Sunucu adı en az 2 karakter olmalı" });
      }
      if (iconColor !== null && !/^#[0-9a-f]{6}$/i.test(iconColor)) {
        return sendJson(response, 400, { error: "Geçerli bir simge rengi seçmelisin" });
      }
      await query(
        `UPDATE servers SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           icon_color = COALESCE($4, icon_color)
         WHERE id = $1`,
        [
          serverId,
          name,
          body.description === undefined ? null : text(body.description, 180),
          iconColor
        ]
      );
      return sendJson(response, 200, { ok: true });
    }
    if (method === "DELETE" && serverRoute) {
      const serverId = serverRoute[1];
      const owned = await query("SELECT id FROM servers WHERE id = $1 AND owner_id = $2", [serverId, user.id]);
      if (!owned.rowCount) return sendJson(response, 403, { error: "Yalnızca sunucu sahibi sunucuyu silebilir" });
      await query("DELETE FROM servers WHERE id = $1", [serverId]);
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
      const granted = await permissions(serverId, user.id);
      if (!granted) return sendJson(response, 404, { error: "Sunucu bulunamadı" });
      const [server, categories, channels, members, memberRoles, roles] = await Promise.all([
        query("SELECT id, name, description, icon_color, owner_id, created_at FROM servers WHERE id = $1", [serverId]),
        query("SELECT id, name, position FROM channel_categories WHERE server_id = $1 ORDER BY position", [serverId]),
        query("SELECT id, category_id, name, type, position, is_private, allowed_role_ids, user_limit, audio_bitrate, quality_mode FROM channels WHERE server_id = $1 ORDER BY position", [serverId]),
        query(
          `SELECT u.id, u.display_name, u.handle, u.is_site_owner, m.nickname, m.joined_at
             FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.server_id = $1 ORDER BY m.joined_at`,
          [serverId]
        ),
        query(
          `SELECT mr.user_id, r.id, r.name, r.color, r.position
             FROM member_roles mr JOIN roles r ON r.id = mr.role_id
            WHERE mr.server_id = $1 ORDER BY r.position DESC`,
          [serverId]
        ),
        query("SELECT id, name, color, position, permissions, is_system FROM roles WHERE server_id = $1 ORDER BY position DESC", [serverId])
      ]);
      const rolesByMember = new Map();
      for (const role of memberRoles.rows) {
        if (!rolesByMember.has(role.user_id)) rolesByMember.set(role.user_id, []);
        rolesByMember.get(role.user_id).push({
          id: role.id,
          name: role.name,
          color: role.color,
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
        members: granted.has("members.view") ? normalizedMembers : [],
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
        permissions: validPermissions(body.permissions),
        position: Number.isFinite(actorPosition) ? Math.min(requestedPosition, actorPosition - 1) : requestedPosition
      };
      if (!role.name) return sendJson(response, 400, { error: "Rol adı gerekli" });
      await query(
        `INSERT INTO roles (id, server_id, name, color, position, permissions)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [role.id, serverId, role.name, text(body.color, 20) || "#8d7aff", role.position, JSON.stringify(role.permissions)]
      );
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
        return sendJson(response, 200, { ok: true });
      }
      const body = await readJson(request);
      await query(
        `UPDATE roles SET
           name = COALESCE($3, name),
           color = COALESCE($4, color),
           position = COALESCE($5, position),
           permissions = COALESCE($6::jsonb, permissions)
         WHERE id = $1 AND server_id = $2`,
        [
          roleId,
          serverId,
          body.name ? text(body.name, 30) : null,
          body.color ? text(body.color, 20) : null,
          Number.isFinite(Number(body.position))
            ? (Number.isFinite(actorPosition) ? Math.min(Number(body.position), actorPosition - 1) : Number(body.position))
            : null,
          Array.isArray(body.permissions) ? JSON.stringify(validPermissions(body.permissions)) : null
        ]
      );
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
      const channelResult = await query("SELECT id, server_id, type FROM channels WHERE id = $1", [messageRoute[1]]);
      const channel = channelResult.rows[0];
      if (!channel || !(await membership(channel.server_id, user.id))) return sendJson(response, 404, { error: "Kanal bulunamadı" });
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
    if (error.code === "23505" || /UNIQUE constraint failed/i.test(error.message)) {
      return sendJson(response, 409, { error: "Bu kayıt zaten mevcut" });
    }
    console.error(error);
    sendJson(response, 500, { error: "Sunucu hatası" });
  }
}

module.exports = { handleApi };
