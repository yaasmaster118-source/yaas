# YAAS Production Security Deployment

## Render origin and database

### Ücretsiz alternatif: Neon + mevcut Render hizmeti

YAAS'ın ücretsiz kalıcı veritabanı için seçilen geçici production çözümü Neon Free PostgreSQL'dir. [2 Ekim 2026 plan duyurusu](https://neon.com/blog/neon-free-plan-1-gb-per-project) proje başına 1 GB depolama, ayda 100 CU-saat ve 6 saat anlık geri dönüş penceresi belirtir. Kota ve soğuk başlangıç gecikmesi göz önünde bulundurulmalıdır; bağımsız yedek hâlâ gerekir.

1. Neon hesabına giriş yapın; yeni hesap kullanım koşullarını kullanıcı kendisi onaylamalıdır.
2. `YAAS` adında Free proje oluşturun. Render bölgesine yakın Avrupa bölgesi seçin. Ücretli yükseltme veya otomatik ödeme açmayın.
3. Neon bağlantı panelinden PostgreSQL URL'sini alın. Değeri yalnızca Render `DATABASE_URL` secret alanına koyun; sohbete veya Git'e yazmayın.
4. `NODE_ENV=production` ve `DATABASE_SSL_ALLOW_SELF_SIGNED=0` kullanın. Neon bağlantısında sertifika doğrulaması açık tutulmalıdır. `sslmode=no-verify` kullanmayın.
5. Mevcut SQLite verisini yedekleyip yeni veritabanına kontrollü olarak aktarın. Aktarım ve kayıt sayısı kontrolü yapılmadan Render'ı yeniden başlatmayın.
6. Sağlık kontrolü ve owner login çalıştıktan sonra güvenlik dalını main'e alın ve deploy edin.

E-posta için Resend Free kullanılabilir: [resmi fiyatlandırma](https://www.resend.com/pricing?product=transactional) ayda 3.000 ve günde 100 e-posta sınırı belirtir. Gönderim alan adı yoksa ilk testler yalnızca Resend hesabının kendi adresine gönderilebilir; gerçek gönderici alan adı daha sonra doğrulanmalıdır. Resend hesabı henüz bağlanmamıştır.

4 Ekim 2026 kurulum durumu: Neon'da `YAAS` Free projesi Frankfurt bölgesinde oluşturuldu (`broad-sea-34167397`). Panel bu hesap için 0,5 GB alan gösteriyor; gerçek kota panelden kontrol edilmelidir. Proje henüz Render'a bağlanmadı ve veri aktarılmadı. Canlı Render ortamında `DATABASE_URL` yok. Canlı yedek girişimi ek onay nedeniyle engellendi; yedek varmış gibi işlem yapılmamalıdır. Yeni güvenlik kodu `security/production-hardening` dalında ve taslak PR #1'de bekliyor.

1. Create Render Postgres in the same region as YAAS. Use its internal URL for `DATABASE_URL`; Render recommends internal URLs for same-region services: [Postgres connection guide](https://render.com/docs/postgresql-creating-connecting).
2. Set `DATABASE_URL`, `OWNER_EMAIL`, `SECURITY_LOG_SALT`, OAuth/TURN credentials, and optionally `SECURITY_ALERT_WEBHOOK_URL` as Render secrets. Never commit their values.
3. Keep `NODE_ENV=production` and `TRUST_PROXY=1`. Deploy and confirm `/health` returns 200. [Render health checks](https://render.com/docs/health-checks) can restart an unhealthy instance.
4. Add and verify the production domain under Render **Settings → Custom Domains**. Render manages TLS and HTTPS redirects: [custom domains](https://render.com/docs/custom-domains), [TLS](https://render.com/docs/tls).
5. After the domain works through Cloudflare, disable the public `onrender.com` subdomain. Render then rejects direct requests before they reach YAAS.

## Cloudflare DNS and TLS

Create a proxied CNAME to the Render hostname. Remove conflicting or unproxied origin records. Set encryption to **Full (strict)**, enable Always Use HTTPS, and enable HSTS only after every required hostname works on HTTPS. References: [SSL modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/) and [HSTS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/).

## WAF and bot controls

Enable Cloudflare Managed Rules and the OWASP ruleset in log mode, inspect false positives, then block. Use narrow exceptions by rule ID and route. Suggested order:

| Priority | Match | Action |
|---|---|---|
| 1 | Valid Render health checks to `/health` | Allow |
| 2 | Methods outside GET/HEAD/POST/PATCH/PUT/DELETE/OPTIONS | Block |
| 3 | `/api/admin/*` with bad reputation or high bot score | Managed Challenge |
| 4 | `/api/auth/*` with bad reputation or high bot score | Managed Challenge |
| 5 | Scanner, traversal, SQLi, or XSS rule hits | Block |

Test Google and Apple callback paths after every WAF change. References: [managed rules](https://developers.cloudflare.com/waf/managed-rules/) and [custom rules](https://developers.cloudflare.com/waf/custom-rules/).

## Edge rate limiting

Configure Cloudflare limits in addition to the in-process limits:

| Route | Threshold | Mitigation |
|---|---:|---|
| `POST /api/auth/login` | 10/minute/IP | Block 10 minutes |
| `POST /api/auth/register` | 5/15 minutes/IP | Challenge or block |
| Friend/message requests | 20/minute/IP | Block 5 minutes |
| `POST */messages` | 60/minute/IP | Block 1 minute |
| Server/channel/invite creation | 20/minute/IP | Block 5 minutes |
| All `/api/*` | 600/minute/IP | Managed Challenge |

Start in counting mode and verify Studio/voice calls are excluded before enforcement. See [Cloudflare rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/).

## Monitoring

### YAAS e-posta uyarıları

Alıcı: `yaasmaster118@gmail.com`. Render'da `SECURITY_ALERT_EMAIL` değerini bu adres olarak ayarlayın. Gönderim için Resend hesabı ve doğrulanmış gönderici alan adı gerekir. `RESEND_API_KEY` anahtarını yalnızca Render secret olarak, `SECURITY_ALERT_FROM` değerini doğrulanmış gönderici olarak ekleyin. Anahtarı sohbete veya Git'e yazmayın. API bağlantısı [Resend resmi e-posta API'sine](https://resend.com/docs/api-reference/emails/send-email) göre hazırlanmıştır. Gerçek teslim testi yapılmadan teslimatın çalıştığı varsayılmamalıdır.

`PUBLIC_ORIGIN` kullanılıyorsa kanonik HTTPS alan adını belirtin. `TRUST_CLOUDFLARE=1` yalnızca doğrudan origin erişimi kapatıldıktan ve Cloudflare proxy zinciri doğrulandıktan sonra kullanılmalıdır; aksi halde istemci kendi Cloudflare IP başlığını taklit edebilir.

- Point `SECURITY_ALERT_WEBHOOK_URL` to a private incident receiver. YAAS aggregates repeated high/critical events for five minutes and sends no raw IP or secret.
- Alert on repeated login failures, 401/403/429 spikes, origin rejection, denied admin access, database errors, health restarts, and failed deploys.
- Review Render logs, Cloudflare Security Events, and workspace access monthly.
- Use a protected Render environment so only workspace admins can modify secrets or destructive resources: [Render protected environments](https://render.com/docs/projects).

## Release checklist

- Run `npm ci`, `npm run check`, `npm audit --omit=dev`, and a secret scan.
- Verify login/logout, expired sessions, owner-only Security Center, IDOR boundaries, invalid/oversize input, image rejection, and 429 responses.
- Check response headers with `curl -I https://your-domain.example/`.
- Confirm Security Center reports persistent database and alert webhook status correctly.
- Complete a backup and restore drill before declaring production ready.
