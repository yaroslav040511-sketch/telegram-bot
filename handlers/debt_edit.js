// handlers/debt_edit.js
module.exports = function registerDebtEditHandler(bot, deps) {
  const { db } = deps;

  // /debt_edit chase balance 5200
  // /debt_edit chase apr 19.9
  // /debt_edit chase minimum 110

  bot.onText(/^\/debt_edit\s+(\S+)\s+(balance|apr|minimum)\s+(\d+(\.\d+)?)$/i,
    (msg, match) => {

      const chatId = msg.chat.id;

      try {

        const name = match[1];
        const field = match[2].toLowerCase();
        const value = Number(match[3]);

        if (!Number.isFinite(value) || value < 0) {
          return bot.sendMessage(chatId,
            "Value must be a valid number."
          );
        }

        const debt = db.prepare(`
        SELECT id, name, balance, apr, minimum
        FROM debts
        WHERE lower(name) = lower(?)
      `).get(name);

        if (!debt) {
          return bot.sendMessage(chatId, `Debt not found: ${name}`);
        }

        let column;

        if (field === "balance") column = "balance";
        if (field === "apr") column = "apr";
        if (field === "minimum") column = "minimum";

        db.prepare(`
        UPDATE debts
        SET ${column} = ?
        WHERE id = ?
      `).run(value, debt.id);

        let out = "💳 Debt Updated\n\n";
        out += `${debt.name}\n`;

        if (field === "balance") {
          out += `Balance: $${debt.balance.toFixed(2)} → $${value.toFixed(2)}`;
        }

        if (field === "apr") {
          out += `APR: ${debt.apr}% → ${value}%`;
        }

        if (field === "minimum") {
          out += `Minimum: $${debt.minimum.toFixed(2)} → $${value.toFixed(2)}`;
        }

        return bot.sendMessage(chatId, out);

      } catch (err) {
        console.error("debt_edit error:", err);
        return bot.sendMessage(chatId, "Error editing debt.");
      }
    });
};
