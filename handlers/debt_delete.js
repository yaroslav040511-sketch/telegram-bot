// handlers/debt_delete.js
module.exports = function registerDebtDeleteHandler(bot, deps) {
  const { db } = deps;

  // /debt_delete chase
  bot.onText(/^\/debt_delete\s+(\S+)$/i, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const name = match[1];

      const debt = db.prepare(`
        SELECT id, name, balance, apr, minimum
        FROM debts
        WHERE lower(name) = lower(?)
      `).get(name);

      if (!debt) {
        return bot.sendMessage(chatId, `Debt not found: ${name}`);
      }

      db.prepare(`
        DELETE FROM debts
        WHERE id = ?
      `).run(debt.id);

      let out = "🗑️ Debt Deleted\n\n";
      out += `${debt.name}\n`;
      out += `Balance: $${Number(debt.balance).toFixed(2)}\n`;
      out += `APR: ${Number(debt.apr).toFixed(1)}%\n`;
      out += `Minimum: $${Number(debt.minimum).toFixed(2)}`;

      return bot.sendMessage(chatId, out);
    } catch (err) {
      console.error("debt_delete error:", err);
      return bot.sendMessage(chatId, "Error deleting debt.");
    }
  });
};
