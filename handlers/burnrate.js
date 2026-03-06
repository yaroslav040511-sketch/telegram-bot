// handlers/burnrate.js
module.exports = function registerBurnrateHandler(bot, deps) {
  const { db, ledgerService } = deps;

  bot.onText(/^\/burnrate(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;

    try {
      // Current bank balance
      const balances = ledgerService.getBalances();
      const bank = balances.find((b) => b.account === "assets:bank");
      const bankBalance = Number(bank?.balance) || 0;

      // This month's income / expenses from posted ledger transactions
      const rows = db.prepare(`
        SELECT
          a.type as type,
          SUM(p.amount) as total
        FROM transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
          AND (a.type = 'INCOME' OR a.type = 'EXPENSES')
        GROUP BY a.type
      `).all();

      let income = 0;
      let expenses = 0;

      for (const r of rows) {
        const v = Math.abs(Number(r.total) || 0);
        if (r.type === "INCOME") income = v;
        if (r.type === "EXPENSES") expenses = v;
      }

      const netMonthly = income - expenses;
      const burnMonthly = netMonthly < 0 ? Math.abs(netMonthly) : 0;
      const burnDaily = burnMonthly / 30;

      let runwayText = "∞";
      if (burnMonthly > 0) {
        const months = bankBalance / burnMonthly;
        const days = bankBalance / burnDaily;
        runwayText = `${months.toFixed(1)} months (${Math.floor(days)} days)`;
      }

      let out = "🔥 Burn Rate\n\n";
      out += `Bank Balance:      $${bankBalance.toFixed(2)}\n`;
      out += `Monthly Income:    $${income.toFixed(2)}\n`;
      out += `Monthly Expenses:  $${expenses.toFixed(2)}\n`;
      out += `Net Monthly:       $${netMonthly.toFixed(2)}\n`;

      if (burnMonthly > 0) {
        out += `Burn / Month:      $${burnMonthly.toFixed(2)}\n`;
        out += `Burn / Day:        $${burnDaily.toFixed(2)}\n`;
      } else {
        out += `Burn / Month:      $0.00\n`;
        out += `Burn / Day:        $0.00\n`;
      }

      out += `Runway:            ${runwayText}`;

      return bot.sendMessage(chatId, "```\n" + out + "\n```", {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Burnrate error:", err);
      return bot.sendMessage(chatId, "Error calculating burn rate.");
    }
  });
};
