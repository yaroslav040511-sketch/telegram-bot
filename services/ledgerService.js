const db = require("../models/db");

/*
  Determine account type from account name
*/
function inferAccountType(accountName) {
  if (accountName.startsWith("assets:")) return "ASSETS";
  if (accountName.startsWith("expenses:")) return "EXPENSES";
  if (accountName.startsWith("income:")) return "INCOME";
  if (accountName.startsWith("liabilities:")) return "LIABILITIES";
  return "OTHER";
}

/*
  Ensures account exists.
  If not, creates it.
*/
function getOrCreateAccount(accountName) {

  const find = db.prepare(`
    SELECT id FROM accounts WHERE name = ?
  `);

  let account = find.get(accountName);

  if (account) return account.id;

  const insert = db.prepare(`
    INSERT INTO accounts (name, type)
    VALUES (?, ?)
  `);

  const type = inferAccountType(accountName);

  const result = insert.run(accountName, type);
  return result.lastInsertRowid;
}

/*
  Add full transaction object
  Expected format:
  {
    date,
    description,
    postings: [
      { account, amount }
    ]
  }
*/
function addTransaction(transaction) {

  if (!transaction.postings || transaction.postings.length < 2) {
    throw new Error("Transaction must contain at least two postings.");
  }

  const insertTransaction = db.prepare(`
    INSERT INTO transactions (date, description)
    VALUES (?, ?)
  `);

  const insertPosting = db.prepare(`
    INSERT INTO postings (transaction_id, account_id, amount)
    VALUES (?, ?, ?)
  `);

  const tx = db.transaction(() => {

    const result = insertTransaction.run(
      transaction.date,
      transaction.description
    );

    const transactionId = result.lastInsertRowid;

    for (const p of transaction.postings) {

      const accountId = getOrCreateAccount(p.account);

      insertPosting.run(
        transactionId,
        accountId,
        p.amount
      );
    }
  });

  tx();
}

/* ==================================
 * UNDO
   =============================== */

function deleteLastTransaction() {

  const getLast = db.prepare(`
    SELECT id, date, description
    FROM transactions
    ORDER BY id DESC
    LIMIT 1
  `);

  const last = getLast.get();

  if (!last) return null;

  const deletePostings = db.prepare(`
    DELETE FROM postings WHERE transaction_id = ?
  `);

  const deleteTransaction = db.prepare(`
    DELETE FROM transactions WHERE id = ?
  `);

  const tx = db.transaction(() => {
    deletePostings.run(last.id);
    deleteTransaction.run(last.id);
  });

  tx();

  return last;
}

  function getLedger(limit = 20, offset = 0) {
  return db.prepare(`
    SELECT 
      t.id as transaction_id,
      t.date,
      t.description,
      a.name as account,
      p.amount
    FROM transactions t
    JOIN postings p ON p.transaction_id = t.id
    JOIN accounts a ON a.id = p.account_id
    ORDER BY t.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

}

module.exports = {
  addTransaction,
  deleteLastTransaction,
  getLedger
};
