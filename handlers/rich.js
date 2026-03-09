// handlers/rich.js
module.exports = function registerRichHandler(bot, deps) {
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

    return income - bills;
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

  function simulateMilestones(startCash, monthlyNet, debtRows, targets) {
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
    const targetDebtBudget = totalMinimums + debtExtra;

    let cash = startCash;
    let months = 0;

    while (months < 2400) {
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

      if (activeDebts().length > 0) {
        for (const d of debts) {
          if (d.balance <= 0.005) continue;
          const monthlyRate = d.apr / 100 / 12;
          d.balance += d.balance * monthlyRate;
        }

        let paymentPool = Math.max(0, Math.min(cash, targetDebtBudget));

        const remaining = activeDebts();
        sortDebts(remaining);

        for (const d of remaining) {
          if (paymentPool <= 0) break;
          const minPay = Math.min(d.minimum, d.balance, paymentPool);
          d.balance -= minPay;
          paymentPool -= minPay;
          cash -= minPay;
        }

        let targetsNow = activeDebts();
        sortDebts(targetsNow);

        while (paymentPool > 0 && targetsNow.length > 0) {
          const target = targetsNow[0];
          const pay = Math.min(target.balance, paymentPool);
          target.balance -= pay;
          paymentPool -= pay;
          cash -= pay;

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

  function renderHelp() {
    return [
      "*\\/rich*",
      "Show projected net worth milestone dates based on current assets, recurring cashflow, and debt payoff.",
      "",
      "*Usage*",
      "- `/rich`",
      "",
      "*Examples*",
      "- `/rich`",
      "",
      "*Notes*",
      "- Starting assets include `assets:bank` and `assets:savings`.",
      "- Debt is paid down using avalanche logic before larger wealth milestones accelerate."
    ].join("\n");
  }

  bot.onText(/^\/rich(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return bot.sendMessage(chatId, renderHelp(), { parse_mode: "Markdown" });
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/rich` command does not take arguments.",
          "",
          "Usage:",
          "`/rich`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const starting = getStartingAssets();
      const cash = starting.total;
      const monthlyNet = getRecurringMonthlyNet();
      const debtRows = getDebtRows();

      const totalDebt = debtRows.reduce((sum, d) => sum + d.balance, 0);
      const netWorthNow = cash - totalDebt;

      const targets = [50000, 100000, 250000, 500000, 1000000];
      const monthsMap = simulateMilestones(cash, monthlyNet, debtRows, targets);

      const lines = [
        "💸 *Rich Timeline*",
        "",
        codeBlock([
          `Bank Now        ${formatMoney(starting.bank)}`,
          `Savings Now     ${formatMoney(starting.savings)}`,
          `Assets Now      ${formatMoney(cash)}`,
          `Debt Now        ${formatMoney(totalDebt)}`,
          `Net Worth Now   ${netWorthNow >= 0 ? "+" : "-"}${formatMoney(Math.abs(netWorthNow))}`,
          `Recurring Net   ${monthlyNet >= 0 ? "+" : "-"}${formatMoney(Math.abs(monthlyNet))}/mo`,
          "------------------------------",
          ...targets.map((target) => {
            const months = monthsMap[target];
            const label = `${formatMoney(target)}:`.padEnd(16);
            return months == null
              ? `${label} >200 years`
              : `${label} ${futureMonthLabel(months)}`;
          })
        ].join("\n"))
      ];

      let summary;
      if (monthsMap[1000000] != null) {
        summary = `At your current trajectory, $1M net worth lands around ${futureMonthLabel(monthsMap[1000000])}.`;
      } else if (monthsMap[100000] != null) {
        summary = `At your current trajectory, six figures lands around ${futureMonthLabel(monthsMap[100000])}.`;
      } else {
        summary = "Your trajectory is positive, but larger wealth milestones are still far out.";
      }

      lines.push(summary);

      return bot.sendMessage(chatId, lines.join("\n"), {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("rich error:", err);
      return bot.sendMessage(chatId, "Error generating rich timeline.");
    }
  });
};

module.exports.help = {
  command: "rich",
  category: "Forecasting",
  summary: "Show projected net worth milestone dates based on current assets, recurring cashflow, and debt payoff.",
  usage: [
    "/rich"
  ],
  examples: [
    "/rich"
  ],
  notes: [
    "Starting assets include `assets:bank` and `assets:savings`.",
    "Debt is paid down using avalanche logic before larger wealth milestones accelerate."
  ]
};
