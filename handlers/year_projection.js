// handlers/year_projection.js
module.exports = function registerYearProjectionHandler(bot, deps) {
  const { db, ledgerService } = deps;

  function monthlyMultiplier(freq) {
    switch ((freq || "").toLowerCase()) {
      case "daily":
        return 30;
      case "weekly":
        return 4.33;
      case "monthly":
        return 1;
      case "yearly":
        return 1 / 12;
      default:
        return 0;
    }
  }

  bot.onText(/^\/year_projection(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;

    try {
      const balances = ledgerService.getBalances();
      const bank = balances.find((b) => b.account === "assets:bank");
      const currentBalance = Number(bank?.balance) || 0;

      const rows = db.prepare(`
        SELECT description, postings_json, frequency
        FROM recurring_transactions
        ORDER BY id ASC
      `).all();

      let recurringIncomeMonthly = 0;
      let recurringBillsMonthly = 0;

      for (const r of rows) {
        const mult = monthlyMultiplier(r.frequency);
        if (!mult) continue;

        let bankAmt = 0;
        try {
          const postings = JSON.parse(r.postings_json);
          const bankLine = Array.isArray(postings)
            ? postings.find((p) => p.account === "assets:bank")
            : null;

          bankAmt = Number(bankLine?.amount) || 0;
        } catch {
          bankAmt = 0;
        }

        const monthlyAmt = Math.abs(bankAmt) * mult;

        if (bankAmt > 0) recurringIncomeMonthly += monthlyAmt;
        if (bankAmt < 0) recurringBillsMonthly += monthlyAmt;
      }

      const netMonthly = recurringIncomeMonthly - recurringBillsMonthly;
      const projected12Months = currentBalance + netMonthly * 12;

      let out = "📈 12-Month Projection\n\n";
      out += `Current Balance:     $${currentBalance.toFixed(2)}\n`;
      out += `Recurring Income:    $${recurringIncomeMonthly.toFixed(2)} / month\n`;
      out += `Recurring Bills:     $${recurringBillsMonthly.toFixed(2)} / month\n`;
      out += `Net Monthly:         ${netMonthly >= 0 ? "+" : "-"}$${Math.abs(netMonthly).toFixed(2)}\n`;
      out += `-----------------------------------\n`;
      out += `Projected in 12 mo:  $${projected12Months.toFixed(2)}`;

      return bot.sendMessage(chatId, "```\n" + out + "\n```", {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Year projection error:", err);
      return bot.sendMessage(chatId, "Error calculating year projection.");
    }
  });
};
