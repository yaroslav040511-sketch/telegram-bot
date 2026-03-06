// handlers/money.js
module.exports = function registerMoneyHandler(bot, deps) {
  const { db, ledgerService } = deps;

  bot.onText(/^\/money(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;

    try {
      const balances = ledgerService.getBalances();

      let assets = 0;
      let liabilities = 0;

      for (const b of balances) {
        const amount = Number(b.balance) || 0;

        if (b.account.startsWith("assets:")) {
          assets += amount;
        }

        if (b.account.startsWith("liabilities:")) {
          liabilities += amount;
        }
      }

      const netWorth = assets - liabilities;

      const recurring = db.prepare(`
        SELECT postings_json
        FROM recurring_transactions
      `).all();

      let monthlyIncome = 0;
      let monthlyBills = 0;

      for (const r of recurring) {
        try {
          const postings = JSON.parse(r.postings_json);
          const bank = postings.find(p => p.account === "assets:bank");

          if (!bank) continue;

          const amt = Number(bank.amount) || 0;

          if (amt > 0) {
            monthlyIncome += amt;
          } else {
            monthlyBills += Math.abs(amt);
          }

        } catch { }
      }

      const netMonthly = monthlyIncome - monthlyBills;

      const nextBill = db.prepare(`
        SELECT description, next_due_date, postings_json
        FROM recurring_transactions
        ORDER BY date(next_due_date)
        LIMIT 1
      `).get();

      let nextBillText = "None";

      if (nextBill) {
        try {
          const postings = JSON.parse(nextBill.postings_json);
          const bank = postings.find(p => p.account === "assets:bank");

          if (bank) {
            const amt = Math.abs(Number(bank.amount) || 0);
            nextBillText = `${nextBill.next_due_date} ${nextBill.description} $${amt}`;
          }

        } catch { }
      }

      let runwayText = "N/A";

      if (monthlyBills > 0) {
        const daily = monthlyBills / 30;
        const days = Math.floor(assets / daily);

        runwayText = `${days} days`;
      }

      let out = "💰 Financial Snapshot\n\n";

      out += `Balance:        $${assets.toFixed(2)}\n`;
      out += `Net Worth:      $${netWorth.toFixed(2)}\n\n`;

      out += `Monthly Income: $${monthlyIncome.toFixed(2)}\n`;
      out += `Monthly Bills:  $${monthlyBills.toFixed(2)}\n`;
      out += `Net Monthly:    $${netMonthly.toFixed(2)}\n\n`;

      out += `Next Bill:\n• ${nextBillText}\n\n`;

      out += `Runway:\n~ ${runwayText} at current burn`;

      return bot.sendMessage(chatId, out);

    } catch (err) {
      console.error("Money handler error:", err);
      return bot.sendMessage(chatId, "Error generating financial snapshot.");
    }
  });
};
