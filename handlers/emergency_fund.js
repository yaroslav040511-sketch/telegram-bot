// handlers/emergency_fund.js
module.exports = function registerEmergencyFundHandler(bot, deps) {
  const { db, ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
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

  function futureMonthLabel(monthsAhead) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthsAhead);
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  }

  function getBankBalance() {
    const balances = ledgerService.getBalances();
    const bank = balances.find((b) => b.account === "assets:bank");
    return Number(bank?.balance) || 0;
  }

  function getMonthlyExpenses() {
    const row = db.prepare(`
      SELECT IFNULL(SUM(p.amount), 0) as total
      FROM transactions t
      JOIN postings p ON p.transaction_id = t.id
      JOIN accounts a ON a.id = p.account_id
      WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
        AND a.type = 'EXPENSES'
    `).get();

    return Math.abs(Number(row?.total) || 0);
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
        const bankLine = Array.isArray(postings)
          ? postings.find((p) => p.account === "assets:bank")
          : null;

        if (!bankLine) continue;

        const amt = Number(bankLine.amount) || 0;
        const monthly = Math.abs(amt) * monthlyMultiplier(r.frequency);

        if (amt > 0) income += monthly;
        if (amt < 0) bills += monthly;
      } catch { }
    }

    return income - bills;
  }

  bot.onText(/^\/emergency_fund(@\w+)?(?:\s+(\d{1,2}))?$/i, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const monthsTarget = match[2] ? Number(match[2]) : 3;

      if (!Number.isInteger(monthsTarget) || monthsTarget < 1 || monthsTarget > 24) {
        return bot.sendMessage(chatId, "Usage: /emergency_fund [months]\nExample: /emergency_fund 6");
      }

      const cash = getBankBalance();
      const monthlyExpenses = getMonthlyExpenses();
      const recurringNet = getRecurringMonthlyNet();

      if (monthlyExpenses <= 0) {
        return bot.sendMessage(chatId, "This month's expenses are zero or unavailable, so emergency fund target cannot be calculated.");
      }

      const target = monthlyExpenses * monthsTarget;
      const gap = target - cash;
      const fundedPct = target > 0 ? (cash / target) * 100 : 0;

      let statusText;
      if (cash >= target) {
        statusText = "✅ Target already funded.";
      } else if (recurringNet <= 0) {
        statusText = "⚠️ Target not funded, and recurring surplus is not positive.";
      } else {
        statusText = "🟡 In progress.";
      }

      let etaText = "unavailable";
      if (cash >= target) {
        etaText = "already funded";
      } else if (recurringNet > 0) {
        const monthsToGoal = Math.ceil(gap / recurringNet);
        etaText = `${monthsToGoal} month(s) (${futureMonthLabel(monthsToGoal)})`;
      }

      let out = "🛟 Emergency Fund\n\n";
      out += "```\n";
      out += `Cash on Hand:      ${money(cash)}\n`;
      out += `Monthly Expenses:  ${money(monthlyExpenses)}\n`;
      out += `Target Months:     ${monthsTarget}\n`;
      out += `Target Fund:       ${money(target)}\n`;
      out += `Recurring Surplus: ${recurringNet >= 0 ? "+" : "-"}${money(Math.abs(recurringNet))}\n`;
      out += `Funded:            ${fundedPct.toFixed(0)}%\n`;
      out += `Gap:               ${gap > 0 ? money(gap) : money(0)}\n`;
      out += `ETA:               ${etaText}\n`;
      out += "```";
      out += `\n${statusText}`;

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("emergency_fund error:", err);
      return bot.sendMessage(chatId, "Error calculating emergency fund.");
    }
  });
};
