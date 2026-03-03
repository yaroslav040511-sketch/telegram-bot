module.exports = function registerBalanceHandler(bot, db) {

  bot.onText(/^\/balance(@\w+)?$/, (msg) => {
    try {

      // Adjust this query if your checking account logic differs
      const row = db.prepare(`
        SELECT SUM(amount) as balance
        FROM postings
      `).get();

      const total = Number(row?.balance) || 0;

      bot.sendMessage(
        msg.chat.id,
        `💰 Current Balance: $${total.toFixed(2)}`
      );

    } catch (err) {
      console.error("Balance error:", err);
      bot.sendMessage(msg.chat.id, "Balance error.");
    }
  });

};
