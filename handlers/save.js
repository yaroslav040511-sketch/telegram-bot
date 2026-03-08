// handlers/save.js
module.exports = function registerSaveHandler(bot, deps) {
  const { ledgerService } = deps;

  bot.onText(/^\/save(@\w+)?\s+(\d+(\.\d+)?)$/i, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const amount = Number(match[2]);

      if (!Number.isFinite(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "Usage: /save <amount>\nExample: /save 94.59");
      }

      ledgerService.addTransaction({
        date: new Date().toISOString().slice(0, 10),
        description: "Savings transfer",
        postings: [
          { account: "assets:bank", amount: -amount },
          { account: "assets:savings", amount: amount }
        ]
      });

      let out = "💾 Savings Transfer\n\n";
      out += `Moved $${amount.toFixed(2)} from bank to savings.`;

      return bot.sendMessage(chatId, out);
    } catch (err) {
      console.error("save error:", err);
      return bot.sendMessage(chatId, "Error recording savings transfer.");
    }
  });
};
