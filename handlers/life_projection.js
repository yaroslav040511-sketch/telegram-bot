const { yearsMonths } = require("../utils/dates");

module.exports = function registerLifeProjectionHandler(bot, deps) {
  const { db, ledgerService, finance, debt } = deps;
  const {
    getStartingAssets,
    getRecurringMonthlyNet,
    getDebtRows
  } = finance;
  const { runDebtSimulation } = debt;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  function futureDate(monthsAhead) {
    const d = new Date();
    d.setMonth(d.getMonth() + monthsAhead);
    const month = d.toLocaleString("en-US", { month: "long" });
    const year = d.getFullYear();
    return `${month} ${year}`;
  }

  function getMonthlyActuals() {
    const rows = db.prepare(`
      SELECT
        a.type as type,
        SUM(p.amount) as total
      FROM transactions t
      JOIN postings p ON p.transaction_id = t.id
      JOIN accounts a ON a.id = p.account_id
      WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
        AND (a.type = 'INCOME' OR a.type = 'EXPENSES')
      GROUP BY a.type
    `).all();

    let income = 0;
    let expenses = 0;

    for (const r of rows) {
      const v = Math.abs(Number(r.total) || 0);
      if (r.type === "INCOME") income = v;
      if (r.type === "EXPENSES") expenses = v;
    }

    return {
      income,
      expenses,
      net: income - expenses
    };
  }

  function simulateRetirement(startBalance, monthlySave, annualReturn, target) {
    if (monthlySave <= 0) return null;

    const monthlyRate = annualReturn / 100 / 12;
    let balance = startBalance;
    let months = 0;

    while (balance < target && months < 1200) {
      balance = balance * (1 + monthlyRate) + monthlySave;
      months += 1;
    }

    if (months >= 1200) return null;
    return months;
  }

  bot.onText(/^\/life_projection(@\w+)?$/i, (msg) => {
    const chatId = msg.chat.id;

    try {
      const starting = getStartingAssets(ledgerService);
      const bankBalance = starting.bank;
      const recurring = getRecurringMonthlyNet(db);
      const monthly = getMonthlyActuals();
      const debtRows = getDebtRows(db);

      const totalDebt = debtRows.reduce((sum, d) => sum + d.balance, 0);
      const totalMinimums = debtRows.reduce((sum, d) => sum + d.minimum, 0);

      const debtExtra = Math.max(0, recurring.net);
      const debtPlan = runDebtSimulation(debtRows, "avalanche", debtExtra);

      const annualExpenses = monthly.expenses * 12;
      const fiTarget = annualExpenses > 0 ? annualExpenses * 25 : 0;
      const fiMonths = fiTarget > 0
        ? simulateRetirement(bankBalance, Math.max(0, recurring.net), 7, fiTarget)
        : null;

      const projected12mo = bankBalance + recurring.net * 12;

      let outlook = "";
      if (recurring.net > 0 && totalDebt > 0) {
        outlook = "Strong surplus with debt payoff opportunity.";
      } else if (recurring.net > 0 && totalDebt === 0) {
        outlook = "Strong surplus and no debt drag.";
      } else if (recurring.net <= 0 && totalDebt > 0) {
        outlook = "Debt and weak surplus need attention.";
      } else {
        outlook = "Stable, but growth depends on improving surplus.";
      }

      let out = "🧭 Life Projection\n\n";
      out += "```\n";
      out += `Cash on Hand:      ${money(bankBalance)}\n`;
      out += `Monthly Net:       ${monthly.net >= 0 ? "+" : "-"}${money(Math.abs(monthly.net))}\n`;
      out += `Recurring Net:     ${recurring.net >= 0 ? "+" : "-"}${money(Math.abs(recurring.net))}\n`;
      out += `Debt Total:        ${money(totalDebt)}\n`;
      out += `Debt Min/Month:    ${money(totalMinimums)}\n`;
      out += `12mo Projection:   ${money(projected12mo)}\n`;

      if (debtPlan.months === null) {
        out += `Debt-Free Date:    >100 years\n`;
      } else if (totalDebt <= 0) {
        out += `Debt-Free Date:    Already debt-free\n`;
      } else {
        const debtDate = futureDate(debtPlan.months);
        const ymDebt = yearsMonths(debtPlan.months);
        out += `Debt-Free Date:    ${debtDate} (${ymDebt.years}y ${ymDebt.months}m)\n`;
      }

      if (fiTarget <= 0) {
        out += `FI Date:           unavailable\n`;
      } else if (fiMonths === null) {
        out += `FI Target:         ${money(fiTarget)}\n`;
        out += `FI Date:           >100 years\n`;
      } else {
        const fiDate = futureDate(fiMonths);
        const ymFi = yearsMonths(fiMonths);
        out += `FI Target:         ${money(fiTarget)}\n`;
        out += `FI Date:           ${fiDate} (${ymFi.years}y ${ymFi.months}m)\n`;
      }

      out += "```";
      out += `\n${outlook}`;

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("life_projection error:", err);
      return bot.sendMessage(chatId, "Error generating life projection.");
    }
  });
};
