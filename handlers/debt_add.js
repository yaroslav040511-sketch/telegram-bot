module.exports = function registerDebtAddHandler(bot, deps) {
  const { db } = deps;

  bot.onText(/^\/debt_add\s+(\S+)\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)$/, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const name = match[1];
      const balance = Number(match[2]);
      const apr = Number(match[4]);
      const minimum = Number(match[6]);

      db.prepare(`
        INSERT OR REPLACE INTO debts (name, balance, apr, minimum)
        VALUES (?, ?, ?, ?)
      `).run(name, balance, apr, minimum);

      return bot.sendMessage(
        chatId,
        `💳 Debt added\n\n${name}\nBalance: $${balance.toFixed(2)}\nAPR: ${apr}%\nMinimum: $${minimum.toFixed(2)}`
      );

    } catch (err) {
      console.error("debt_add error:", err);
      return bot.sendMessage(chatId, "Error adding debt.");
    }
  });
};
