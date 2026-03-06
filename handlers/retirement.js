module.exports = function registerRetirementHandler(bot, deps) {

  const { db, ledgerService } = deps;

  function yearsMonths(months) {
    const y = Math.floor(months / 12);
    const m = months % 12;
    return { y, m };
  }

  function formatMoney(n) {
    return `$${Number(n).toFixed(2)}`;
  }

  function monthlyMultiplier(freq) {
    switch ((freq || "").toLowerCase()) {
      case "daily": return 30;
      case "weekly": return 4.33;
      case "monthly": return 1;
      case "yearly": return 1 / 12;
      default: return 0;
    }
  }

  function getBankBalance() {
    const balances = ledgerService.getBalances();
    const bank = balances.find(b => b.account === "assets:bank");
    return Number(bank?.balance) || 0;
  }

  function getRecurringMonthlyNet() {

    const rows = db.prepare(`
      SELECT postings_json, frequency
      FROM recurring_transactions
    `).all();

    let income = 0;
    let bills = 0;

    for (const r of rows) {

      try {

        const postings = JSON.parse(r.postings_json);
        const bankLine = postings.find(p => p.account === "assets:bank");

        if (!bankLine) continue;

        const amt = Number(bankLine.amount) || 0;
        const monthly = Math.abs(amt) * monthlyMultiplier(r.frequency);

        if (amt > 0) income += monthly;
        if (amt < 0) bills += monthly;

      } catch { }
    }

    return income - bills;
  }

  function simulate(startBalance, monthlySave, annualReturn, target) {

    const monthlyRate = annualReturn / 100 / 12;

    let balance = startBalance;
    let months = 0;

    while (balance < target && months < 1200) {

      balance = balance * (1 + monthlyRate) + monthlySave;
      months++;

    }

    return months;
  }

  function targetDate(months) {

    const d = new Date();
    d.setMonth(d.getMonth() + months);

    const month = d.toLocaleString("en-US", { month: "long" });
    const year = d.getFullYear();

    return `${month} ${year}`;
  }

  // ---------------------------------------------------
  // /retirement
  // ---------------------------------------------------

  bot.onText(
    /^\/retirement(@\w+)?\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)$/i,
    (msg, match) => {

      const chatId = msg.chat.id;

      try {

        const monthlySave = Number(match[2]);
        const annualReturn = Number(match[4]);
        const target = Number(match[6]);

        if (monthlySave <= 0) {
          return bot.sendMessage(chatId, "Monthly savings must be > 0.");
        }

        const startBalance = getBankBalance();

        const months = simulate(startBalance, monthlySave, annualReturn, target);
        const { y, m } = yearsMonths(months);

        const date = targetDate(months);

        let out = "🏖️ Retirement Projection\n\n";

        out += "```\n";
        out += `Starting Balance:   ${formatMoney(startBalance)}\n`;
        out += `Monthly Investment: ${formatMoney(monthlySave)}\n`;
        out += `Annual Return:      ${annualReturn}%\n`;
        out += `Target:             ${formatMoney(target)}\n`;
        out += "-----------------------------------\n";
        out += `Time to Goal:       ${y}y ${m}m\n`;
        out += `Target Date:        ${date}\n`;
        out += "```";

        return bot.sendMessage(chatId, out, {
          parse_mode: "Markdown"
        });

      } catch (err) {

        console.error("retirement error:", err);

        return bot.sendMessage(
          chatId,
          "Error calculating retirement."
        );
      }
    }
  );

  // ---------------------------------------------------
  // /retirement_auto
  // ---------------------------------------------------

  bot.onText(
    /^\/retirement_auto(@\w+)?\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)$/i,
    (msg, match) => {

      const chatId = msg.chat.id;

      try {

        const annualReturn = Number(match[2]);
        const target = Number(match[4]);

        const startBalance = getBankBalance();
        const monthlySave = getRecurringMonthlyNet();

        if (monthlySave <= 0) {
          return bot.sendMessage(
            chatId,
            "Recurring surplus is not positive, cannot auto-invest."
          );
        }

        const months = simulate(startBalance, monthlySave, annualReturn, target);
        const { y, m } = yearsMonths(months);

        const date = targetDate(months);

        let out = "🏖️ Retirement Projection (Auto)\n\n";

        out += "```\n";
        out += `Starting Balance:   ${formatMoney(startBalance)}\n`;
        out += `Monthly Surplus:    ${formatMoney(monthlySave)}\n`;
        out += `Annual Return:      ${annualReturn}%\n`;
        out += `Target:             ${formatMoney(target)}\n`;
        out += "-----------------------------------\n";
        out += `Time to Goal:       ${y}y ${m}m\n`;
        out += `Target Date:        ${date}\n`;
        out += "```";

        return bot.sendMessage(chatId, out, {
          parse_mode: "Markdown"
        });

      } catch (err) {

        console.error("retirement_auto error:", err);

        return bot.sendMessage(
          chatId,
          "Error calculating retirement_auto."
        );
      }
    }
  );

};
