module.exports = function registerNetWorthHandler(bot, db, reportService) {

  const { getNetWorthData } = reportService;

  bot.onText(/^\/networth(@\w+)?$/, (msg) => {
    try {

      const rows = getNetWorthData(db);

      if (!rows || !rows.length) {
        return bot.sendMessage(
          msg.chat.id,
          "No assets or liabilities recorded."
        );
      }

      let output = "💎 Net Worth Statement\n\n";

      rows.forEach(r => {
        output += `${r.account} : ${Number(r.balance).toFixed(2)}\n`;
      });

      bot.sendMessage(msg.chat.id, output);

    } catch (err) {
      console.error("Net worth error:", err);
      bot.sendMessage(msg.chat.id, "Error generating net worth statement.");
    }
  });

};
