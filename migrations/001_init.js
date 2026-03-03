module.exports.up = (db) => {

  db.prepare(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE,
      type TEXT
    )
  `).run();

  // other tables...
};
