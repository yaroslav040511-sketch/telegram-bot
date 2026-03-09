// handlers/timeline.js
module.exports = function registerTimelineHandler(bot, deps) {
  const { db, ledgerService, simulateCashflow, format } = deps;
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

  function getMonthlyExpenses() {
    const row = db.prepare(`
      SELECT IFNULL(SUM(p.amount), 0) as total
      FROM transactions t
      JOIN postings p ON p.transaction_id = t.id
      JOIN accounts a ON a.id = p.account_id
      WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
        AND a.name LIKE 'expenses:%'
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

  function simulateDebtPayoffMonths(rows, extra) {
    const debts = rows.map((r) => ({ ...r }));

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

  function simulateNetWorthMilestoneMonths(startCash, monthlyNet, debtRows, targets) {
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

        let paymentPool = Math.max(0, Math.min(cash, monthlyDebtBudget));

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

  function parseLocalDate(dateStr) {
    const s = String(dateStr || "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;

    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setHours(12, 0, 0, 0);
    return d;
  }

  function findNextIncome() {
    const recurring = db.prepare(`
      SELECT description, postings_json, next_due_date
      FROM recurring_transactions
    `).all();

    let nextIncome = null;

    for (const r of recurring) {
      try {
        const postings = JSON.parse(r.postings_json);
        const bankLine = Array.isArray(postings)
          ? postings.find((p) => p.account === "assets:bank")
          : null;

        if (bankLine && Number(bankLine.amount) > 0) {
          const d = parseLocalDate(r.next_due_date);
          if (!d) continue;

          if (!nextIncome || d < nextIncome.date) {
            nextIncome = {
              date: d,
              dateText: String(r.next_due_date || ""),
              amount: Number(bankLine.amount) || 0,
              description: String(r.description || "")
            };
          }
        }
      } catch {
        // ignore malformed recurring rows
      }
    }

    return nextIncome;
  }

  function renderHelp() {
    return [
      "*\\/timeline*",
      "Show a compact financial timeline including current net worth, next income, danger point, debt-free date, FI date, and key wealth milestones.",
      "",
      "*Usage*",
      "- `/timeline`",
      "",
      "*Examples*",
      "- `/timeline`",
      "",
      "*Notes*",
      "- Starting assets include `assets:bank` and `assets:savings`.",
      "- Danger point is based on the 30-day cashflow simulation for `assets:bank`."
    ].join("\n");
  }

  bot.onText(/^\/timeline(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return bot.sendMessage(chatId, renderHelp(), {
          parse_mode: "Markdown"
        });
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/timeline` command does not take arguments.",
          "",
          "Usage:",
          "`/timeline`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const starting = getStartingAssets();
      const bank = starting.bank;
      const savings = starting.savings;
      const totalAssets = starting.total;

      const debtRows = getDebtRows();
      const totalDebt = debtRows.reduce((sum, d) => sum + d.balance, 0);
      const netWorthNow = totalAssets - totalDebt;
      const monthlyNet = getRecurringMonthlyNet();

      const checking = db.prepare(`
        SELECT id
        FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(chatId, "Checking account not found.");
      }

      const sim = simulateCashflow(db, bank, checking.id, 30);
      const timeline = Array.isArray(sim.timeline) ? sim.timeline : [];
      let lowestEvent = null;

      for (const event of timeline) {
        if (!lowestEvent || Number(event.balance) < Number(lowestEvent.balance)) {
          lowestEvent = event;
        }
      }

      const nextIncome = findNextIncome();

      const debtMonths = simulateDebtPayoffMonths(
        debtRows,
        Math.max(0, monthlyNet)
      );

      const monthlyExpenses = getMonthlyExpenses();
      const annualExpenses = monthlyExpenses * 12;
      const fiTarget = annualExpenses > 0 ? annualExpenses * 25 : 0;
      const fiMonths = simulateFIMonths(
        totalAssets,
        Math.max(0, monthlyNet),
        7,
        fiTarget
      );

      const wealthTargets = [10000, 25000, 50000, 100000];
      const wealthMap = simulateNetWorthMilestoneMonths(
        totalAssets,
        monthlyNet,
        debtRows,
        wealthTargets
      );

      const lines = [
        "🛣️ *Timeline*",
        "",
        codeBlock([
          `Bank Now         ${formatMoney(bank)}`,
          `Savings Now      ${formatMoney(savings)}`,
          `Assets Now       ${formatMoney(totalAssets)}`,
          `Debt Now         ${formatMoney(totalDebt)}`,
          `Net Worth Now    ${netWorthNow >= 0 ? "+" : "-"}${formatMoney(Math.abs(netWorthNow))}`,
          nextIncome
            ? `Next Income      ${formatMoney(nextIncome.amount)} ${nextIncome.dateText}`
            : `Next Income      unavailable`,
          lowestEvent
            ? `Danger Point     ${formatMoney(lowestEvent.balance)} on ${lowestEvent.date}`
            : `Danger Point     unavailable`,
          debtRows.length === 0
            ? `Debt Free        already debt-free`
            : debtMonths == null
              ? `Debt Free        >100 years`
              : `Debt Free        ${futureMonthLabel(debtMonths)}`,
          fiTarget <= 0 || fiMonths == null
            ? `FI Date          unavailable`
            : `FI Date          ${futureMonthLabel(fiMonths)}`,
          "------------------------------",
          ...wealthTargets.map((target) => {
            const months = wealthMap[target];
            const label = `${formatMoney(target)}:`.padEnd(16);
            return months == null
              ? `${label} >200 years`
              : `${label} ${futureMonthLabel(months)}`;
          })
        ].join("\n"))
      ];

      if (nextIncome?.description) {
        lines.push(`Next income source: \`${nextIncome.description}\``);
      }

      return bot.sendMessage(chatId, lines.join("\n"), {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("timeline error:", err);
      return bot.sendMessage(chatId, "Error generating timeline.");
    }
  });
};

module.exports.help = {
  command: "timeline",
  category: "Forecasting",
  summary: "Show a compact financial timeline including current net worth, next income, danger point, debt-free date, FI date, and key wealth milestones.",
  usage: [
    "/timeline"
  ],
  examples: [
    "/timeline"
  ],
  notes: [
    "Starting assets include `assets:bank` and `assets:savings`.",
    "Danger point is based on the 30-day cashflow simulation for `assets:bank`."
  ]
};
