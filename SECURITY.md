# YAAS Security

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, personal data, or production logs. Send the report privately to the repository owner. Include the affected route, reproduction steps, impact, and a minimal proof of concept. Rotate any credential that might have been exposed before sharing the report.

## Security model

- Authentication sessions use 256-bit random tokens. Only a SHA-256 digest is stored in the database. Cookies are `HttpOnly`, `SameSite=Lax`, `Priority=High`, and `Secure` in production. Expired sessions are rejected and old sessions are capped per account.
- Site administration is restricted server-side to `is_site_owner`. Server roles remain scoped to their own server. UI visibility is never treated as authorization.
- Database statements use bound parameters. Server, channel, role, invitation, DM, stream, and voice access are checked against the authenticated user.
- Mutating API requests require the same origin. Sensitive actions use separate rate-limit buckets. Request bodies have strict size limits.
- Security events store a one-way IP digest and redacted metadata. Passwords, cookies, tokens, OAuth codes, and secrets must never enter event metadata.
- Avatar and logo data URLs accept PNG, JPEG, or WebP only, validate magic bytes, and are limited to 512 KB decoded. Remote image URLs require HTTPS.
- Production responses set CSP, HSTS, frame denial, MIME sniffing protection, referrer policy, permissions policy, COOP, and CORP headers.

## Roles and sensitive actions

`is_site_owner` is the site `ADMIN` role. A server owner has all permissions only within that server. Custom server roles act as moderators according to their explicit permissions. Ordinary members receive only assigned server permissions.

Server deletion, ownership transfer, role creation/change/deletion, member role assignment/removal, and security-dashboard access create audit records. Security events include failed/successful logins, rate-limit blocks, rejected origins, and denied admin access.

## Incident response

1. Preserve Render and Cloudflare logs and note the first observed time.
2. Disable the affected account or route; rotate OAuth credentials, webhook URLs, database credentials, and any exposed secret.
3. Invalidate sessions with `DELETE FROM sessions`; target one user with `WHERE user_id = ...` when possible.
4. Review `security_events` and `admin_audit_logs`, then Cloudflare Security Events and Render logs.
5. Restore into an isolated database, verify integrity, then switch `DATABASE_URL` only after validation.
6. Record the cause, scope, remediation, and prevention work without copying secrets into the report.

## Final audit

### IMPLEMENTED

- Server-side sessions, expiration checks, logout invalidation, secure production cookie flags, session cap, and generic login errors.
- Server-side authorization for site-owner controls and server resources; parameterized database access.
- Route-specific rate limits with `Retry-After` and rate-limit response headers.
- Same-origin mutation checks, body limits, safe static path handling, request/header timeouts, generic production errors.
- Security headers including CSP, HSTS, clickjacking protection, MIME protection, referrer policy, permissions policy, COOP, and CORP.
- Structured security events with redaction and hashed IP addresses; audit logs for sensitive administration.
- Admin-only Security Center showing recent counts/events and production readiness signals.
- Optional aggregated webhook alerting for high/critical events.
- Image type, signature, protocol, and size validation.
- Internal source, configuration, Git, and database files are excluded from public static serving. Private text-channel read/write endpoints enforce allowed-role access.
- Public registration cannot claim the reserved owner email or grant site-owner status.
- Resend email alert adapter and duplicate suppression are implemented and tested with mocked delivery.
- Automated checks for auth persistence, authorization/IDOR boundaries, session expiry behavior, invalid input, headers, rate-limit policy, and upload signature validation.

### PARTIALLY IMPLEMENTED

- Brute-force defense is per-IP/route and intentionally avoids account lockout denial-of-service. Distributed enforcement must also be configured in Cloudflare.
- Alerts support a generic webhook. Provider-specific email/SMS delivery depends on the selected external service.
- GitHub Actions security checks and weekly dependency updates are configured. Remote workflow execution is pending merging the update; local `npm audit` is also available.
- Uploads are stored as small validated image data or HTTPS references. A dedicated object-storage malware scanning pipeline is not present.

### MANUAL SETUP REQUIRED

- Create Render PostgreSQL, set the internal connection URL as `DATABASE_URL`, and verify the dashboard says “Kalıcı veritabanı: Aktif”.
- Set `OWNER_EMAIL`, OAuth credentials, a random `SECURITY_LOG_SALT`, and optionally `SECURITY_ALERT_WEBHOOK_URL` in Render secrets.
- For the requested email destination, configure `SECURITY_ALERT_EMAIL=yaasmaster118@gmail.com`, `SECURITY_ALERT_FROM`, and `RESEND_API_KEY`, then verify actual delivery. No email service is configured yet.
- Add a custom domain to Render, proxy it through Cloudflare, disable the `onrender.com` subdomain, and configure WAF/rate-limit rules as described in `SECURITY_DEPLOYMENT.md`.
- Enable MFA on GitHub, Render, Cloudflare, Google/Apple developer, database, and owner identity accounts.
- Configure and test automated backups and restore drills from `BACKUP_RECOVERY.md`.

### NOT IMPLEMENTED

- Native TOTP/WebAuthn MFA and password-reset flows. OAuth users rely on their identity provider's MFA. Local accounts currently require operator-assisted recovery.
- Antivirus/content-disarm scanning because YAAS has no general document/video upload endpoint.
- Multi-region active-active failover and a dedicated SIEM.

### SECURITY RISKS

- Running without `DATABASE_URL` on Render uses ephemeral SQLite and can lose accounts, messages, sessions, and logs after restart or redeploy.
- The public `onrender.com` hostname can bypass Cloudflare until it is disabled after adding a verified custom domain.
- In-memory application rate limits reset on deploy and are per instance; Cloudflare limits are required for distributed enforcement.
- Pending alert aggregation is in memory and is lost on restart; a durable alert queue is still needed for guaranteed delivery. Log retention and off-site log export are not automated.
- CSP still permits inline styles because the current UI uses them. Removing inline styling would allow a stricter `style-src` policy.
- Site-owner status is controlled by `OWNER_EMAIL`; protect changes to that environment variable and audit Render workspace access.

