"use strict";

const crypto = require("crypto");
const { query, getPool } = require("../src/database");
const { hashPassword } = require("../src/auth");

async function main() {
  const email = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.OWNER_PASSWORD || "");
  const displayName = String(process.env.OWNER_NAME || "Ali").trim().slice(0, 40);

  if (!email.includes("@") || password.length < 8) {
    throw new Error("OWNER_EMAIL and an OWNER_PASSWORD of at least 8 characters are required.");
  }

  const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows[0]) {
    await query(
      "UPDATE users SET is_site_owner = TRUE, display_name = $2 WHERE id = $1",
      [existing.rows[0].id, displayName]
    );
    console.log("Existing YAAS account promoted to site owner.");
    return;
  }

  const baseHandle = email.split("@")[0].replace(/[^\w.]/g, "").toLowerCase().slice(0, 18) || "owner";
  await query(
    `INSERT INTO users (id, email, display_name, handle, password_hash, is_site_owner)
     VALUES ($1, $2, $3, $4, $5, TRUE)`,
    [
      crypto.randomUUID(),
      email,
      displayName,
      `${baseHandle}-${crypto.randomBytes(2).toString("hex")}`,
      await hashPassword(password)
    ]
  );
  console.log("YAAS site owner account created.");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => {});
  });
