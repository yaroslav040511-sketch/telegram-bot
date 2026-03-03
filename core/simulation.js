// core/simulation.js

function simulateCashflow(db, startingBalance, checkingId, days) {

  let projectedBalance = startingBalance;
  let lowestBalance = startingBalance;
  let lowestDate = null;
  let lowestTrigger = null;

  const today = new Date();
  const endDate = new Date();
  endDate.setDate(today.getDate() + days);

  const endDateString = endDate.toISOString().slice(0, 10);

  const recurring = db.prepare(`
    SELECT *
    FROM recurring
    WHERE next_run <= ?
    ORDER BY next_run ASC
  `).all(endDateString);

  const timeline = [];

  for (const r of recurring) {

    if (r.debit_account_id === checkingId) {
      projectedBalance += r.amount;
    }

    if (r.credit_account_id === checkingId) {
      projectedBalance -= r.amount;
    }

    timeline.push({
      date: r.next_run,
      description: r.description,
      balance: projectedBalance
    });

    if (projectedBalance < lowestBalance) {
      lowestBalance = projectedBalance;
      lowestDate = r.next_run;
      lowestTrigger = r.description;
    }
  }

  return {
    lowestBalance,
    lowestDate,
    lowestTrigger,
    timeline
  };
}

module.exports = { simulateCashflow };
