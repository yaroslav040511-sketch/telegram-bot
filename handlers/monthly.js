module.exports = function registerMonthlyHandler(bot, deps) {
  const { db } = deps;

  bot.onText(/^\/monthly(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;

    try {
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

      const net = income - expenses;

      let out = "📊 This Month\n\n";
      out += `Income:     $${income.toFixed(2)}\n`;
      out += `Expenses:   $${expenses.toFixed(2)}\n`;
      out += `--------------------\n`;
      out += `Net:        $${net.toFixed(2)}`;

      return bot.sendMessage(chatId, "```\n" + out + "\n```", {
        parse_mode: "Markdown"
      });

    } catch (err) {
      console.error("Monthly error:", err);
      return bot.sendMessage(chatId, "Error calculating monthly totals.");
    }
  });
};
