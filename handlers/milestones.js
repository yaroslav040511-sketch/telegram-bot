// handlers/milestones.js
module.exports = function registerMilestonesHandler(bot, deps) {
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

  function futureMonthLabel(monthsAhead) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthsAhead);
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
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
      } catch {
        // ignore malformed recurring rows
      }
    }

    return {
      income,
      bills,
      net: income - bills
    };
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

  function getDebtRows() {
    return db.prepare(`
      SELECT name, balance, apr, minimum
      FROM debts
    `).all().map((r) => ({
      name: String(r.name || ""),
      balance: Number(r.balance) || 0,
      apr: Number(r.apr) || 0,
      minimum: Number(r.minimum) || 0
    }));
  }

  function simulateDebtPayoffMonths(rows, mode, extra) {
    const debts = rows.map((r) => ({ ...r }));

    function sortDebts(arr) {
      if (mode === "snowball") {
        arr.sort((a, b) => {
          const balDiff = a.balance - b.balance;
          if (balDiff !== 0) return balDiff;
          return b.apr - a.apr;
        });
      } else {
        arr.sort((a, b) => {
          const aprDiff = b.apr - a.apr;
          if (aprDiff !== 0) return aprDiff;
          return a.balance - b.balance;
        });
      }
    }

    function activeDebts() {
      return debts.filter((d) => d.balance > 0.005);
    }

    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const monthlyBudget = totalMinimums + extra;

    if (debts.length === 0) return 0;
    if (monthlyBudget <= 0) return null;

    let months = 0;

    while (activeDebts().length > 0 && months < 1200) {
      months += 1;

      for (const d of debts) {
        if (d.balance <= 0.005) continue;
        const monthlyRate = d.apr / 100 / 12;
        d.balance += d.balance * monthlyRate;
      }

      const remaining = activeDebts();
      sortDebts(remaining);

      let paymentPool = monthlyBudget;

      for (const d of remaining) {
        if (paymentPool <= 0) break;
        const minPay = Math.min(d.minimum, d.balance, paymentPool);
        d.balance -= minPay;
        paymentPool -= minPay;
      }

      let targets = activeDebts();
      sortDebts(targets);

      while (paymentPool > 0 && targets.length > 0) {
        const target = targets[0];
        const pay = Math.min(target.balance, paymentPool);
        target.balance -= pay;
        paymentPool -= pay;

        targets = activeDebts();
        sortDebts(targets);
      }

      for (const d of debts) {
        if (d.balance < 0.005) d.balance = 0;
      }
    }

    return months >= 1200 ? null : months;
  }

  function simulateNetWorthMilestoneMonths(startBalance, monthlyNet, debtRows, targets) {
    const debts = debtRows.map((r) => ({ ...r }));
    const results = {};
    const sortedTargets = [...targets].sort((a, b) => a - b);

    function sortDebts(arr) {
      arr.sort((a, b) => {
        const aprDiff = b.apr - a.apr;
        if (aprDiff !== 0) return aprDiff;
        return a.balance - b.balance;
      });
    }

    function activeDebts() {
      return debts.filter((d) => d.balance > 0.005);
    }

    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const debtExtra = Math.max(0, monthlyNet);
    const monthlyDebtBudget = totalMinimums + debtExtra;

    let cash = startBalance;
    let months = 0;

    while (months < 1200) {
      const totalDebt = debts.reduce((sum, d) => sum + d.balance, 0);
      const netWorth = cash - totalDebt;

      for (const t of sortedTargets) {
        if (results[t] == null && netWorth >= t) {
          results[t] = months;
        }
      }

      if (sortedTargets.every((t) => results[t] != null)) break;

      months += 1;
      cash += monthlyNet;

      if (activeDebts().length > 0 && monthlyDebtBudget > 0) {
        for (const d of debts) {
          if (d.balance <= 0.005) continue;
          const monthlyRate = d.apr / 100 / 12;
          d.balance += d.balance * monthlyRate;
        }

        const remaining = activeDebts();
        sortDebts(remaining);

        let paymentPool = monthlyDebtBudget;

        for (const d of remaining) {
          if (paymentPool <= 0) break;
          const minPay = Math.min(d.minimum, d.balance, paymentPool);
          d.balance -= minPay;
          paymentPool -= minPay;
        }

        let targetsNow = activeDebts();
        sortDebts(targetsNow);

        while (paymentPool > 0 && targetsNow.length > 0) {
          const target = targetsNow[0];
          const pay = Math.min(target.balance, paymentPool);
          target.balance -= pay;
          paymentPool -= pay;

          targetsNow = activeDebts();
          sortDebts(targetsNow);
        }

        for (const d of debts) {
          if (d.balance < 0.005) d.balance = 0;
        }
      }
    }

    return results;
  }

  function simulateFIMonths(startBalance, monthlySave, annualReturn, fiTarget) {
    if (monthlySave <= 0 || fiTarget <= 0) return null;
    if (startBalance >= fiTarget) return 0;

    const monthlyRate = annualReturn / 100 / 12;
    let balance = startBalance;
    let months = 0;

    while (balance < fiTarget && months < 1200) {
      balance = balance * (1 + monthlyRate) + monthlySave;
      months += 1;
    }

    return months >= 1200 ? null : months;
  }

  function renderHelp() {
    return [
      "*\\/milestones*",
      "Show estimated dates for debt freedom, financial independence, and selected net worth milestones.",
      "",
      "*Usage*",
      "- `/milestones`",
      "",
      "*Examples*",
      "- `/milestones`",
      "",
      "*Notes*",
      "- Starting assets include `assets:bank` and `assets:savings`.",
      "- Uses recurring net cashflow and debt payoff to estimate milestone timing."
    ].join("\n");
  }

  bot.onText(/^\/milestones(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return bot.sendMessage(chatId, renderHelp(), { parse_mode: "Markdown" });
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/milestones` command does not take arguments.",
          "",
          "Usage:",
          "`/milestones`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const starting = getStartingAssets();
      const startBalance = starting.total;
      const recurring = getRecurringMonthlyNet();
      const monthlyExpenses = getMonthlyExpenses();
      const debtRows = getDebtRows();

      const debtMonths = simulateDebtPayoffMonths(
        debtRows,
        "avalanche",
        Math.max(0, recurring.net)
      );

      const annualExpenses = monthlyExpenses * 12;
      const fiTarget = annualExpenses > 0 ? annualExpenses * 25 : 0;
      const fiMonths = simulateFIMonths(
        startBalance,
        Math.max(0, recurring.net),
        7,
        fiTarget
      );

      const targets = [10000, 25000, 50000, 100000];
      const milestoneMonths = simulateNetWorthMilestoneMonths(
        startBalance,
        recurring.net,
        debtRows,
        targets
      );

      const lines = [
        "📍 *Financial Milestones*",
        "",
        codeBlock([
          `Bank Balance      ${formatMoney(starting.bank)}`,
          `Savings Balance   ${formatMoney(starting.savings)}`,
          `Starting Assets   ${formatMoney(startBalance)}`,
          debtRows.length === 0
            ? `Debt Free         Already debt-free`
            : debtMonths == null
              ? `Debt Free         >100 years`
              : `Debt Free         ${futureMonthLabel(debtMonths)}`,
          fiTarget <= 0 || fiMonths == null
            ? `Financial Indep   unavailable`
            : `Financial Indep   ${futureMonthLabel(fiMonths)}`,
          "-----------------------------",
          ...targets.map((t) => {
            const months = milestoneMonths[t];
            const label = `Net Worth ${formatMoney(t)}:`.padEnd(22);
            return months == null
              ? `${label} >100 years`
              : `${label} ${futureMonthLabel(months)}`;
          })
        ].join("\n"))
      ];

      return bot.sendMessage(chatId, lines.join("\n"), {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("milestones error:", err);
      return bot.sendMessage(chatId, "Error generating milestones.");
    }
  });
};

module.exports.help = {
  command: "milestones",
  category: "Forecasting",
  summary: "Show estimated dates for debt freedom, financial independence, and selected net worth milestones.",
  usage: [
    "/milestones"
  ],
  examples: [
    "/milestones"
  ],
  notes: [
    "Starting assets include `assets:bank` and `assets:savings`.",
    "Uses recurring net cashflow and debt payoff to estimate milestone timing."
  ]
};
