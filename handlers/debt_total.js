// handlers/debt_total.js
module.exports = function registerDebtTotalHandler(bot, deps) {
  const { db } = deps;

  bot.onText(/^\/debt_total(@\w+)?$/i, (msg) => {
    const chatId = msg.chat.id;

    try {
      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      let totalDebt = 0;
      let totalMinimum = 0;
      let weightedAprNumerator = 0;

      for (const r of rows) {
        const balance = Number(r.balance) || 0;
        const apr = Number(r.apr) || 0;
        const minimum = Number(r.minimum) || 0;

        totalDebt += balance;
        totalMinimum += minimum;
        weightedAprNumerator += balance * apr;
      }

      const weightedApr =
        totalDebt > 0 ? weightedAprNumerator / totalDebt : 0;

      let out = "💳 Debt Summary\n\n";
      out += "```\n";
      out += `Total Debt:       $${totalDebt.toFixed(2)}\n`;
      out += `Total Minimums:   $${totalMinimum.toFixed(2)}\n`;
      out += `Weighted APR:     ${weightedApr.toFixed(2)}%\n`;
      out += "```";

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debt_total error:", err);
      return bot.sendMessage(chatId, "Error calculating debt totals.");
    }
  });
};
