// handlers/debt_pay.js
module.exports = function registerDebtPayHandler(bot, deps) {
  const { db } = deps;

  // /debt_pay chase 200
  bot.onText(/^\/debt_pay\s+(\S+)\s+(\d+(\.\d+)?)$/i, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const name = match[1];
      const payment = Number(match[2]);

      if (!Number.isFinite(payment) || payment <= 0) {
        return bot.sendMessage(chatId, "Usage: /debt_pay <name> <amount>");
      }

      const debt = db.prepare(`
        SELECT id, name, balance, apr, minimum
        FROM debts
        WHERE lower(name) = lower(?)
      `).get(name);

      if (!debt) {
        return bot.sendMessage(chatId, `Debt not found: ${name}`);
      }

      const oldBalance = Number(debt.balance) || 0;
      const applied = Math.min(payment, oldBalance);
      const newBalance = Math.max(0, oldBalance - applied);

      db.prepare(`
        UPDATE debts
        SET balance = ?
        WHERE id = ?
      `).run(newBalance, debt.id);

      let out = "💳 Debt Payment Applied\n\n";
      out += `${debt.name}\n`;
      out += `Old Balance: $${oldBalance.toFixed(2)}\n`;
      out += `Payment:     $${applied.toFixed(2)}\n`;
      out += `New Balance: $${newBalance.toFixed(2)}`;

      if (payment > oldBalance) {
        out += `\n\nOnly $${applied.toFixed(2)} was needed to pay this debt off.`;
      }

      return bot.sendMessage(chatId, out);
    } catch (err) {
      console.error("debt_pay error:", err);
      return bot.sendMessage(chatId, "Error applying debt payment.");
    }
  });
};
