// handlers/add.js
module.exports = function registerAddHandler(bot, deps) {
  const { ledgerService } = deps;

  function usage(chatId) {
    return bot.sendMessage(
      chatId,
      "Usage: /add <description> <amount>\nExample: /add groceries 25\nSee /add help"
    );
  }

  bot.onText(/^\/add(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || raw.toLowerCase() === "help") {
      return usage(chatId);
    }

    try {
      // Match: everything up to the last number as description, last number as amount
      const m = raw.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)$/);

      if (!m) {
        return usage(chatId);
      }

      const description = String(m[1] || "").trim();
      const amount = Number(m[2]);

      if (!description || !Number.isFinite(amount) || amount <= 0) {
        return usage(chatId);
      }

      ledgerService.addTransaction({
        date: new Date().toISOString().slice(0, 10),
        description,
        postings: [
          { account: "expenses:misc", amount: amount },
          { account: "assets:bank", amount: -amount }
        ]
      });

      return bot.sendMessage(
        chatId,
        `✅ Expense added\n\n${description}\nAmount: $${amount.toFixed(2)}`
      );
    } catch (err) {
      console.error("add error:", err);
      return bot.sendMessage(chatId, "Error adding expense.");
    }
  });
};
