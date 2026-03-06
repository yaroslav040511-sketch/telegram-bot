module.exports = function registerDebtsHandler(bot, deps) {
  const { db } = deps;

  bot.onText(/^\/debts(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;

    try {
      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
        ORDER BY balance DESC
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      let out = "💳 Debts\n\n```\n";

      for (const r of rows) {
        const name = r.name.padEnd(14);
        const bal = `$${Number(r.balance).toFixed(2)}`.padStart(10);
        const apr = `${Number(r.apr).toFixed(1)}%`.padStart(6);
        const min = `$${Number(r.minimum).toFixed(2)}`.padStart(8);

        out += `${name} ${bal}  APR:${apr}  Min:${min}\n`;
      }

      out += "```";

      return bot.sendMessage(chatId, out, { parse_mode: "Markdown" });

    } catch (err) {
      console.error("debts error:", err);
      return bot.sendMessage(chatId, "Error retrieving debts.");
    }
  });
};
