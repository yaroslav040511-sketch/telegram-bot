// handlers/autopilot.js
module.exports = function registerAutopilotHandler(bot, deps) {
  const { db, simulateCashflow, ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  function getRecurringMonthlyNet() {
    const rows = db.prepare(`
      SELECT postings_json, frequency
      FROM recurring_transactions
    `).all();

    let income = 0;
    let bills = 0;

    function monthlyMultiplier(freq) {
      switch ((freq || "").toLowerCase()) {
        case "daily": return 30;
        case "weekly": return 4.33;
        case "monthly": return 1;
        case "yearly": return 1 / 12;
        default: return 0;
      }
    }

    for (const r of rows) {
      try {
        const postings = JSON.parse(r.postings_json);
        const bankLine = Array.isArray(postings)
          ? postings.find(p => p.account === "assets:bank")
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

  bot.onText(/^\/autopilot(@\w+)?$/i, (msg) => {
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
        SELECT id FROM accounts
        WHERE name='assets:bank'
      `).get();

      const sim = simulateCashflow(db, bank, checking.id, 30);

      const lowest = sim.lowestBalance;

      const debtRow = db.prepare(`
        SELECT IFNULL(SUM(balance),0) as total
        FROM debts
      `).get();

      const debt = Number(debtRow?.total) || 0;

      const monthlyNet = getRecurringMonthlyNet();

      let mode;
      let advice;
      let reason;

      if (lowest < 100) {

        mode = "Preserve Cash";
        reason = `Lowest projected balance is ${money(lowest)}.`;
        advice = "Avoid discretionary spending until next income.";

      } else if (debt > 0 && monthlyNet > 0) {

        mode = "Attack Debt";
        reason = `You have ${money(debt)} in debt and positive cashflow.`;
        advice = "Direct extra cash toward highest APR debt.";

      } else if (savings < 1000) {

        mode = "Build Emergency Fund";
        reason = `Savings are only ${money(savings)}.`;
        advice = "Prioritize building a small emergency cushion.";

      } else {

        mode = "Grow Wealth";
        reason = "Cashflow is positive and debts are manageable.";
        advice = "Direct surplus toward long-term investments.";

      }

      let out = "🤖 Autopilot\n\n";
      out += "```\n";

      out += `Mode:           ${mode}\n`;
      out += `Bank:           ${money(bank)}\n`;
      out += `Savings:        ${money(savings)}\n`;
      out += `Debt:           ${money(debt)}\n`;
      out += `Monthly Net:    ${money(monthlyNet)}\n`;
      out += `Lowest Ahead:   ${money(lowest)}\n`;

      out += "---------------------------\n";
      out += `Reason: ${reason}\n`;
      out += `Action: ${advice}\n`;

      out += "```";

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });

    } catch (err) {
      console.error("autopilot error:", err);
      return bot.sendMessage(chatId, "Autopilot error.");
    }

  });
};
