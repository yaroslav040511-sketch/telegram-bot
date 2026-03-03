module.exports = function registerRecurringHandler(bot, db, recurringService) {

  const { getRecurringTransactions } = recurringService;

  bot.onText(/^\/recurring(@\w+)?$/, (msg) => {
    try {

      const rows = getRecurringTransactions(db);

      if (!rows || !rows.length) {
        return bot.sendMessage(msg.chat.id, "No recurring transactions.");
      }

      let output = "🔁 Recurring Transactions\n\n";

      rows.forEach(r => {
        output += `${r.description} | ${r.amount} | ${r.frequency}\n`;
      });

      bot.sendMessage(msg.chat.id, output);

    } catch (err) {
      console.error("Recurring error:", err);
      bot.sendMessage(msg.chat.id, "Error retrieving recurring transactions.");
    }
  });

};
