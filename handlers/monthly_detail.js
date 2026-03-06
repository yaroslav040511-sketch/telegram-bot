// handlers/monthly_detail.js
module.exports = function registerMonthlyDetailHandler(bot, deps) {
  const { db } = deps;

  bot.onText(/^\/monthly_detail(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;

    try {
      const rows = db.prepare(`
        SELECT
          a.name as account,
          a.type as type,
          SUM(p.amount) as total
        FROM transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
          AND (a.type = 'INCOME' OR a.type = 'EXPENSES')
        GROUP BY a.name, a.type
        ORDER BY a.type ASC, ABS(SUM(p.amount)) DESC, a.name ASC
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No income or expense activity this month.");
      }

      const incomeRows = [];
      const expenseRows = [];
      let incomeTotal = 0;
      let expenseTotal = 0;

      for (const r of rows) {
        const amount = Math.abs(Number(r.total) || 0);

        if (r.type === "INCOME") {
          incomeRows.push({ account: r.account, amount });
          incomeTotal += amount;
        }

        if (r.type === "EXPENSES") {
          expenseRows.push({ account: r.account, amount });
          expenseTotal += amount;
        }
      }

      const net = incomeTotal - expenseTotal;

      function line(account, amount, sign = " ") {
        const name = String(account).padEnd(24);
        const amt = (`$${amount.toFixed(2)}`).padStart(12);
        return `${sign} ${name}${amt}`;
      }

      let out = "📊 Monthly Detail\n\n";
      out += "```\n";

      if (incomeRows.length) {
        out += "INCOME\n";
        out += "-----------------------------\n";
        for (const r of incomeRows) {
          out += line(r.account, r.amount, "+") + "\n";
        }
        out += "\n";
      }

      if (expenseRows.length) {
        out += "EXPENSES\n";
        out += "-----------------------------\n";
        for (const r of expenseRows) {
          const pct = expenseTotal > 0
            ? ((r.amount / expenseTotal) * 100).toFixed(0)
            : "0";

          const base = line(r.account, r.amount, "-");
          out += `${base}   ${pct}%\n`;
        }
        out += "\n";
      }

      out += "TOTALS\n";
      out += "-----------------------------\n";
      out += line("Income", incomeTotal, "+") + "\n";
      out += line("Expenses", expenseTotal, "-") + "\n";
      out += line("Net", Math.abs(net), net >= 0 ? "+" : "-") + "\n";

      out += "```";

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });

    } catch (err) {
      console.error("Monthly detail error:", err);
      return bot.sendMessage(chatId, "Error calculating monthly detail.");
    }
  });
};
