// const db = require("../models/db");
const { addTransaction } = require("./ledgerService");

function addRecurring(description, postings, frequency, nextDueDate) {
  const stmt = db.prepare(`
    INSERT INTO recurring_transactions 
    (description, postings_json, frequency, next_due_date)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(
    description,
    JSON.stringify(postings),
    frequency,
    nextDueDate
  );
}

function processRecurring() {

  const today = new Date().toISOString().slice(0, 10);

  const due = db.prepare(`
    SELECT * FROM recurring_transactions
    WHERE next_due_date <= ?
  `).all(today);

  due.forEach(r => {

    const postings = JSON.parse(r.postings_json);

    addTransaction(today, r.description, postings);

    // calculate next date
    let nextDate = new Date(r.next_due_date);

    if (r.frequency === "monthly") {
      nextDate.setMonth(nextDate.getMonth() + 1);
    }

    if (r.frequency === "weekly") {
      nextDate.setDate(nextDate.getDate() + 7);
    }

    db.prepare(`
      UPDATE recurring_transactions
      SET next_due_date = ?
      WHERE id = ?
    `).run(nextDate.toISOString().slice(0, 10), r.id);
  });

  return due.length;
}

const db = require("../models/db");

function calculateNextRun(date, frequency) {
  const d = new Date(date);

  if (frequency === "monthly") {
    d.setMonth(d.getMonth() + 1);
  }

  if (frequency === "weekly") {
    d.setDate(d.getDate() + 7);
  }

  if (frequency === "daily") {
    d.setDate(d.getDate() + 1);
  }

  return d.toISOString().split("T")[0];
}

function getRecurringTransactions() {
  return db.prepare(`
    SELECT *
    FROM recurring_transactions
    ORDER BY id DESC
  `).all();

  return rows.map(r => ({
    ...r,
    next_run: calculateNextRun(r.date, r.frequency)
  }));
}

function calculateNextRun(date, frequency) {
  const d = new Date(date);

  if (frequency === "monthly") {
    d.setMonth(d.getMonth() + 1);
  }

  if (frequency === "weekly") {
    d.setDate(d.getDate() + 7);
  }

  if (frequency === "daily") {
    d.setDate(d.getDate() + 1);
  }

  return d.toISOString().split("T")[0];
}

module.exports = {
  addRecurring,
  processRecurring,
  getRecurringTransactions
};
