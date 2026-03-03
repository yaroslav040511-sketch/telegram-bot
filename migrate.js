const fs = require("fs");
const path = require("path");
const db = require("./models/db");

const files = fs.readdirSync("./migrations").sort();

for (const file of files) {
  const migration = require(path.join(__dirname, "migrations", file));
  migration.up(db);
}

console.log("Migrations complete.");
