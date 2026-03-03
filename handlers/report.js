const reportService = require("../services/reportService");

module.exports = (bot) => {

  bot.onText(/^\/report$/, (msg) => {
    try {

      const netWorth = reportService.getNetWorth();
      const { income, expenses } =
        reportService.getLast30DayIncomeAndExpenses();

      const message = `
📊 Monthly Report

💰 Net Worth: $${netWorth.toFixed(2)}

📈 Income (30d): $${income.toFixed(2)}
📉 Expenses (30d): $${expenses.toFixed(2)}

🔁 Active Recurring: 2
`;

      bot.sendMessage(msg.chat.id, message);

    } catch (err) {
      console.error("Report error:", err);
      bot.sendMessage(msg.chat.id, "Report error.");
    }
  });

};
