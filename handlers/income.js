module.exports = function registerIncomeHandler(bot, db, reportService) {

  const { getIncomeStatement } = reportService;

  bot.onText(/^\/income(@\w+)?$/, (msg) => {
    try {

      const rows = getIncomeStatement(db);

      if (!rows || !rows.length) {
        return bot.sendMessage(
          msg.chat.id,
          "No income or expenses recorded."
        );
      }

      let output = "📊 Profit & Loss Statement\n\n";

      rows.forEach(r => {
        output += `${r.account} : ${Number(r.balance).toFixed(2)}\n`;
      });

      bot.sendMessage(msg.chat.id, output);

    } catch (err) {
      console.error("Income error:", err);
      bot.sendMessage(msg.chat.id, "Error generating income statement.");
    }
  });

};
