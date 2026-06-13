"use strict";

const fs = require("fs");
const path = require("path");
const { getPool } = require("../src/database");

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await getPool().query(schema);
  console.log("YAAS 1.1 database initialized.");
  await getPool().end();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
