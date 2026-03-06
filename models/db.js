// models/db.js
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function initDb() {
  const dataDir = path.join(__dirname, "..", "data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "ledger.sqlite");
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      postings_json TEXT NOT NULL,
      frequency TEXT NOT NULL,
      next_due_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recurring_id INTEGER NOT NULL,
      occurrence_date TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      UNIQUE(recurring_id, occurrence_date),
      FOREIGN KEY (recurring_id) REFERENCES recurring_transactions(id),
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );

    CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      balance REAL NOT NULL,
      apr REAL NOT NULL,
      minimum REAL NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO accounts (name, type)
    VALUES (?, ?)
  `);

  insert.run("assets:bank", "ASSETS");
  insert.run("income:salary", "INCOME");
  insert.run("expenses:food", "EXPENSES");
  insert.run("expenses:rent", "EXPENSES");
  insert.run("liabilities:creditcard", "LIABILITIES");

  return db;
}

module.exports = initDb();
