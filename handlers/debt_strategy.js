// handlers/debt_strategy.js
module.exports = function registerDebtStrategyHandler(bot, deps) {
  const { db } = deps;

  bot.onText(/^\/debt_strategy\s+(snowball|avalanche)$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const mode = match[1].toLowerCase();

    try {
      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      let debts = [...rows];

      if (mode === "snowball") {
        debts.sort((a, b) => a.balance - b.balance);
      }

      if (mode === "avalanche") {
        debts.sort((a, b) => b.apr - a.apr);
      }

      let out = `💳 Debt Strategy (${mode})\n\n`;
      out += "Attack order:\n\n```\n";

      let i = 1;

      for (const d of debts) {
        const name = d.name.padEnd(14);
        const bal = `$${Number(d.balance).toFixed(2)}`.padStart(10);
        const apr = `${Number(d.apr).toFixed(1)}%`.padStart(6);

        out += `${i}. ${name} ${bal}  APR:${apr}\n`;
        i++;
      }

      out += "```";

      if (mode === "snowball") {
        out += "\nSnowball: smallest balance first for quick wins.";
      }

      if (mode === "avalanche") {
        out += "\nAvalanche: highest interest first to minimize interest.";
      }

      return bot.sendMessage(chatId, out, { parse_mode: "Markdown" });

    } catch (err) {
      console.error("debt_strategy error:", err);
      return bot.sendMessage(chatId, "Error calculating strategy.");
    }
  });
};
