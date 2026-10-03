# YAAS Backup and Recovery

## Scope and targets

Back up PostgreSQL, the deployed Git commit, and a production configuration inventory containing variable names and owners but no plaintext values. Suggested targets are RPO 24 hours and RTO 4 hours. Use paid Render Postgres point-in-time recovery for tighter targets.

## Schedule and retention

- Create one encrypted logical backup daily; retain 14 daily, 8 weekly, and 12 monthly copies in a separate account or bucket.
- Create an extra backup before schema changes and risky releases.
- Run a quarterly restore drill into an isolated database.
- Alert after one failed backup job and investigate the same day.

Render paid PostgreSQL offers point-in-time recovery. Free databases do not include recovery or managed logical backups. Dashboard-created logical exports are retained for seven days: [Render PostgreSQL recovery and backups](https://render.com/docs/postgresql-backups).

## Logical backup

Use the external database URL only from a secured backup runner and require TLS. Keep the URL in the runner's secret manager, not shell history or logs.

```sh
pg_dump --format=custom --no-owner --no-acl --file=yaas-YYYYMMDD.dump "$DATABASE_URL"
```

Encrypt the result, upload it to immutable/versioned storage, record its SHA-256 checksum, and delete the unencrypted local copy.

## Recovery

1. Freeze writes or enable maintenance mode. Preserve logs and record the incident time.
2. Create a new empty PostgreSQL database; do not overwrite the affected database.
3. Restore into the isolated database:

```sh
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RECOVERY_DATABASE_URL" yaas-YYYYMMDD.dump
```

4. Start a temporary YAAS instance against it. Verify user, server, membership, role, message, invite, session, `security_events`, and `admin_audit_logs` counts. Test owner login and critical flows.
5. Rotate the recovered database credential. Update production `DATABASE_URL`, deploy, and verify `/health` plus critical flows.
6. Keep the old database read-only until the incident closes, then remove it under the retention policy.

Render point-in-time recovery creates a separate recovery instance. Validate it before changing production `DATABASE_URL`.

## Drill evidence

Record the backup timestamp, Git commit, operator, restore start/end, checksum result, row-count checks, application checks, achieved RPO/RTO, and every gap. A backup is not verified until a restore drill succeeds.

## SQLite to Neon migration

`scripts/migrate-sqlite.js` reads a SQLite source without modifying it, checks integrity and foreign keys, and imports all known tables into an empty PostgreSQL database in one transaction. It rejects unknown tables/columns, a populated destination, an empty account source, and mismatched row counts. PostgreSQL constraints remain enabled. HTTPS/database credentials must never be printed or committed. TLS certificate verification remains enabled even when the supplied URI contains SSL options.

Run with `SQLITE_SOURCE_PATH` and `DATABASE_URL` provided through private environment variables. Freeze writes and obtain a consistent final snapshot before cutover; a downloaded file alone does not prove consistency while the source is accepting writes. Verify accounts, memberships, messages, OAuth login, and owner permissions before routing production to Neon.

On 2026-10-04, an authorized local backup was encrypted with Windows DPAPI for the current Windows user. Decryption and SQLite integrity checks passed. The downloaded live SQLite database contained zero rows in every application table. Render had no configured `DATABASE_URL`, `LOCAL_DATABASE_PATH`, secret files, or linked environment groups. The user confirmed there was no history to preserve and explicitly authorized continuing empty. The Neon schema was then created transactionally and all 18 application table counts were verified as zero. Production cutover succeeded on 2026-10-04 using commit e5b5e45; the database health check passed and internal SQLite/source URLs now return 404. The backup contains no recoverable past records; DPAPI is a local protection method and is not a portable disaster-recovery backup.
