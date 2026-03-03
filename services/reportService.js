const db = require("../models/db");

/*
  Net Worth = Assets - Liabilities
*/
function getNetWorth() {
  const stmt = db.prepare(`
    SELECT
      LOWER(a.type) as type,
      IFNULL(SUM(p.amount), 0) as total
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    GROUP BY LOWER(a.type)
  `);

  const rows = stmt.all();

  let assets = 0;
  let liabilities = 0;

  for (const row of rows) {
    if (row.type === "assets") {
      assets = row.total;
    }
    if (row.type === "liabilities") {
      liabilities = row.total;
    }
  }

  return assets - liabilities;
}

/*
  Last 30 Days Income & Expenses
*/
function getLast30DayIncomeAndExpenses() {
  const stmt = db.prepare(`
    SELECT
      LOWER(a.type) as type,
      IFNULL(SUM(p.amount), 0) as total
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE LOWER(a.type) IN ('income', 'expenses')
      AND date(t.date) >= date('now', '-30 days')
    GROUP BY LOWER(a.type)
  `);

  const rows = stmt.all();

  let income = 0;
  let expenses = 0;

  for (const row of rows) {
    if (row.type === "income") {
      income = row.total;
    }
    if (row.type === "expenses") {
      expenses = row.total;
    }
  }

  return {
    income,
    expenses
  };
}

module.exports = {
  getNetWorth,
  getLast30DayIncomeAndExpenses
};
