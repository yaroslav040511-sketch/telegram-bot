// handlers/retirement_fi.js
module.exports = function registerRetirementFIHandler(bot, deps) {
  const { db, ledgerService, format } = deps;
  const { formatMoney, codeBlock } = format;

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

  function yearsMonths(totalMonths) {
    return {
      years: Math.floor(totalMonths / 12),
      months: totalMonths % 12
    };
  }

  function targetDate(monthsAhead) {
    const d = new Date();
    d.setMonth(d.getMonth() + monthsAhead);
    const month = d.toLocaleString("en-US", { month: "long" });
    const year = d.getFullYear();
    return `${month} ${year}`;
  }

  function getStartingAssets() {
    const balances = ledgerService.getBalances();

    let bank = 0;
    let savings = 0;

    for (const b of balances) {
      if (b.account === "assets:bank") bank = Number(b.balance) || 0;
      if (b.account === "assets:savings") savings = Number(b.balance) || 0;
    }

    return {
      bank,
      savings,
      total: bank + savings
    };
  }

  function getRecurringMonthlyNet() {
    const rows = db.prepare(`
      SELECT postings_json, frequency
      FROM recurring_transactions
    `).all();

    let recurringIncome = 0;
    let recurringBills = 0;

    for (const r of rows) {
      try {
        const postings = JSON.parse(r.postings_json);
        const bankLine = Array.isArray(postings)
          ? postings.find((p) => p.account === "assets:bank")
          : null;

        if (!bankLine) continue;

        const amt = Number(bankLine.amount) || 0;
        const monthly = Math.abs(amt) * monthlyMultiplier(r.frequency);

        if (amt > 0) recurringIncome += monthly;
        if (amt < 0) recurringBills += monthly;
      } catch {
        // ignore malformed recurring rows
      }
    }

    return recurringIncome - recurringBills;
  }

  function getActualMonthlyExpenses() {
    const row = db.prepare(`
      SELECT SUM(p.amount) as total
      FROM transactions t
      JOIN postings p ON p.transaction_id = t.id
      JOIN accounts a ON a.id = p.account_id
      WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
        AND a.type = 'EXPENSES'
    `).get();

    return Math.abs(Number(row?.total) || 0);
  }

  function renderHelp() {
    return [
      "*\\/retirement_fi*",
      "Estimate time to financial independence using your current assets, recurring monthly surplus, and this month's actual expenses.",
      "",
      "*Usage*",
      "- `/retirement_fi <annual_return_percent>`",
      "",
      "*Arguments*",
      "- `<annual_return_percent>` — Expected annual return percentage, such as `7`.",
      "",
      "*Examples*",
      "- `/retirement_fi 7`",
      "- `/retirement_fi 8.5`",
      "",
      "*Notes*",
      "- Starting assets include `assets:bank` and `assets:savings`.",
      "- FI target uses 25x annual spending.",
      "- Monthly expenses come from the current month's posted expense transactions."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/retirement_fi(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const annualReturn = Number(raw);

      if (!Number.isFinite(annualReturn) || annualReturn < 0) {
        return bot.sendMessage(
          chatId,
          [
            "Annual return must be zero or greater.",
            "",
            "Usage:",
            "`/retirement_fi <annual_return_percent>`",
            "",
            "Example:",
            "`/retirement_fi 7`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const starting = getStartingAssets();
      const startingBalance = starting.total;
      const monthlySave = getRecurringMonthlyNet();
      const monthlyExpenses = getActualMonthlyExpenses();

      if (monthlyExpenses <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "This month's expenses are zero or unavailable, so the FI target cannot be calculated yet."
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (monthlySave <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "Recurring surplus is not positive, so the FI projection cannot be calculated."
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const annualExpenses = monthlyExpenses * 12;
      const fiTarget = annualExpenses * 25;
      const monthlyRate = annualReturn / 100 / 12;

      if (startingBalance >= fiTarget) {
        return bot.sendMessage(
          chatId,
          [
            "🔥 *Financial Independence*",
            "",
            codeBlock([
              `Bank Balance      ${formatMoney(starting.bank)}`,
              `Savings Balance   ${formatMoney(starting.savings)}`,
              `Starting Assets   ${formatMoney(startingBalance)}`,
              `Annual Spending   ${formatMoney(annualExpenses)}`,
              `FI Target         ${formatMoney(fiTarget)}`,
              `Status            Already FI`
            ].join("\n"))
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      let balance = startingBalance;
      let months = 0;

      while (balance < fiTarget && months < 1200) {
        balance = balance * (1 + monthlyRate) + monthlySave;
        months += 1;
      }

      if (months >= 1200) {
        return bot.sendMessage(
          chatId,
          "Projection exceeded 100 years. Increase recurring surplus, return assumption, or reduce expenses."
        );
      }

      const ym = yearsMonths(months);
      const fiDate = targetDate(months);

      const out = [
        "🔥 *Financial Independence*",
        "",
        codeBlock([
          `Bank Balance      ${formatMoney(starting.bank)}`,
          `Savings Balance   ${formatMoney(starting.savings)}`,
          `Starting Assets   ${formatMoney(startingBalance)}`,
          `Monthly Surplus   ${formatMoney(monthlySave)}`,
          `Monthly Expenses  ${formatMoney(monthlyExpenses)}`,
          `Annual Spending   ${formatMoney(annualExpenses)}`,
          `FI Target         ${formatMoney(fiTarget)}`,
          `Annual Return     ${annualReturn.toFixed(2)}%`,
          `Time to FI        ${ym.years}y ${ym.months}m`,
          `FI Date           ${fiDate}`
        ].join("\n"))
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("retirement_fi error:", err);
      return bot.sendMessage(chatId, "Error calculating retirement_fi.");
    }
  });
};

module.exports.help = {
  command: "retirement_fi",
  category: "Forecasting",
  summary: "Estimate time to financial independence using your current assets, recurring monthly surplus, and this month's actual expenses.",
  usage: [
    "/retirement_fi <annual_return_percent>"
  ],
  args: [
    { name: "<annual_return_percent>", description: "Expected annual return percentage, such as 7." }
  ],
  examples: [
    "/retirement_fi 7",
    "/retirement_fi 8.5"
  ],
  notes: [
    "Starting assets include `assets:bank` and `assets:savings`.",
    "FI target uses 25x annual spending.",
    "Monthly expenses come from the current month's posted expense transactions."
  ]
};
