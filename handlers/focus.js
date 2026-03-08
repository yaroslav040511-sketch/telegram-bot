// handlers/focus.js
module.exports = function registerFocusHandler(bot, deps) {
  const { db, simulateCashflow, ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  function monthlyMultiplier(freq) {
    switch ((freq || "").toLowerCase()) {
      case "daily": return 30;
      case "weekly": return 4.33;
      case "monthly": return 1;
      case "yearly": return 1 / 12;
      default: return 0;
    }
  }

  function getRecurringMonthlyNet() {
    const rows = db.prepare(`
      SELECT postings_json, frequency
      FROM recurring_transactions
    `).all();

    let income = 0;
    let bills = 0;

    for (const r of rows) {
      try {
        const postings = JSON.parse(r.postings_json);
        const bankLine = Array.isArray(postings)
          ? postings.find((p) => p.account === "assets:bank")
          : null;

        if (!bankLine) continue;

        const amt = Number(bankLine.amount) || 0;
        const monthly = Math.abs(amt) * monthlyMultiplier(r.frequency);

        if (amt > 0) income += monthly;
        if (amt < 0) bills += monthly;
      } catch { }
    }

    return income - bills;
  }

  function getDebtRows() {
    return db.prepare(`
      SELECT name, balance, apr, minimum
      FROM debts
    `).all().map((r) => ({
      name: r.name,
      balance: Number(r.balance) || 0,
      apr: Number(r.apr) || 0,
      minimum: Number(r.minimum) || 0
    }));
  }

  function findTargetDebt(debtRows) {
    if (!debtRows.length) return null;

    const sorted = [...debtRows].sort((a, b) => {
      const aprDiff = b.apr - a.apr;
      if (aprDiff !== 0) return aprDiff;
      return a.balance - b.balance;
    });

    return sorted[0];
  }

  bot.onText(/^\/focus(@\w+)?$/i, (msg) => {
    const chatId = msg.chat.id;

    try {
      const balances = ledgerService.getBalances();

      let bank = 0;
      let savings = 0;

      for (const b of balances) {
        if (b.account === "assets:bank") bank = Number(b.balance) || 0;
        if (b.account === "assets:savings") savings = Number(b.balance) || 0;
      }

      const checking = db.prepare(`
        SELECT id
        FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(chatId, "Checking account not found.");
      }

      const sim = simulateCashflow(db, bank, checking.id, 30);
      const lowest = Number(sim.lowestBalance) || 0;

      const debtRows = getDebtRows();
      const targetDebt = findTargetDebt(debtRows);
      const totalDebt = debtRows.reduce((sum, d) => sum + d.balance, 0);
      const monthlyNet = getRecurringMonthlyNet();

      let focus;

      if (lowest < 0) {
        focus = "Protect cash immediately and avoid overdraft.";
      } else if (lowest < 100) {
        focus = "Protect cash until payday.";
      } else if (totalDebt > 0 && monthlyNet > 0 && targetDebt) {
        focus = `Attack ${targetDebt.name} first (${targetDebt.apr}% APR).`;
      } else if (savings < 1000) {
        focus = "Build emergency savings to $1,000.";
      } else if (monthlyNet > 0) {
        focus = "Keep growing wealth with your monthly surplus.";
      } else {
        focus = "Stabilize cashflow before making bigger moves.";
      }

      let out = "🎯 Focus\n\n";
      out += focus;

      if (targetDebt && totalDebt > 0 && lowest >= 100) {
        out += `\n\nTop debt target: ${targetDebt.name} • ${money(targetDebt.balance)} • ${targetDebt.apr}% APR`;
      }

      return bot.sendMessage(chatId, out);
    } catch (err) {
      console.error("focus error:", err);
      return bot.sendMessage(chatId, "Error generating focus.");
    }
  });
};
