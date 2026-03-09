// handlers/money.js
module.exports = function registerMoneyHandler(bot, deps) {
  const { db, ledgerService, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/money*",
      "Show a compact financial snapshot including bank balance, debt, net worth, recurring net, debt-free estimate, and FI estimate.",
      "",
      "*Usage*",
      "- `/money`",
      "",
      "*Examples*",
      "- `/money`",
      "",
      "*Notes*",
      "- Balances come from `ledgerService.getBalances()`.",
      "- Recurring net is estimated from `recurring_transactions`.",
      "- FI estimate uses current month expenses and a 7% annual return assumption."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

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

  function signedMoney(value, suffix = "") {
    const n = Number(value) || 0;
    const sign = n >= 0 ? "+" : "-";
    return `${sign}${formatMoney(Math.abs(n))}${suffix}`;
  }

  function getBankBalance() {
    const balances = ledgerService.getBalances();
    const bank = balances.find((b) => b.account === "assets:bank");
    return Number(bank?.balance) || 0;
  }

  function getTotalLiabilities() {
    const balances = ledgerService.getBalances();
    let total = 0;

    for (const b of balances) {
      if (String(b.account).startsWith("liabilities:")) {
        total += Math.abs(Number(b.balance) || 0);
      }
    }

    return total;
  }

  function getNetWorth() {
    const balances = ledgerService.getBalances();
    let assets = 0;
    let liabilities = 0;

    for (const b of balances) {
      const amount = Number(b.balance) || 0;
      const account = String(b.account || "");

      if (account.startsWith("assets:")) assets += amount;
      if (account.startsWith("liabilities:")) liabilities += Math.abs(amount);
    }

    return assets - liabilities;
  }

  function getRecurringMonthlyNet() {
    const rows = db.prepare(`
      SELECT postings_json, frequency
      FROM recurring_transactions
    `).all();

    let income = 0;
    let bills = 0;

    for (const row of rows) {
      try {
        const postings = JSON.parse(row.postings_json);
        const bankLine = Array.isArray(postings)
          ? postings.find((p) => p.account === "assets:bank")
          : null;

        if (!bankLine) continue;

        const amount = Number(bankLine.amount) || 0;
        const monthly = Math.abs(amount) * monthlyMultiplier(row.frequency);

        if (amount > 0) income += monthly;
        if (amount < 0) bills += monthly;
      } catch (_) {
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
        AND a.type = 'EXPENSES'
    `).get();

    return Math.abs(Number(row?.total) || 0);
  }

  function getDebtRows() {
    return db.prepare(`
      SELECT name, balance, apr, minimum
      FROM debts
    `).all().map((row) => ({
      name: row.name,
      balance: Number(row.balance) || 0,
      apr: Number(row.apr) || 0,
      minimum: Number(row.minimum) || 0
    }));
  }

  function simulateDebtPayoffMonths(rows, mode, extra) {
    const debts = rows.map((row) => ({ ...row }));

    function sortDebts(arr) {
      if (mode === "snowball") {
        arr.sort((a, b) => {
          const balanceDiff = a.balance - b.balance;
          if (balanceDiff !== 0) return balanceDiff;
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

      for (const debt of debts) {
        if (debt.balance <= 0.005) continue;
        const monthlyRate = debt.apr / 100 / 12;
        debt.balance += debt.balance * monthlyRate;
      }

      const remaining = activeDebts();
      sortDebts(remaining);

      let paymentPool = monthlyBudget;

      for (const debt of remaining) {
        if (paymentPool <= 0) break;
        const minPay = Math.min(debt.minimum, debt.balance, paymentPool);
        debt.balance -= minPay;
        paymentPool -= minPay;
      }

      let targets = activeDebts();
      sortDebts(targets);

      while (paymentPool > 0 && targets.length > 0) {
        const target = targets[0];
        const payment = Math.min(target.balance, paymentPool);
        target.balance -= payment;
        paymentPool -= payment;

        targets = activeDebts();
        sortDebts(targets);
      }

      for (const debt of debts) {
        if (debt.balance < 0.005) debt.balance = 0;
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

  bot.onText(/^\/money(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw && !/^(help|--help|-h)$/i.test(raw)) {
      return bot.sendMessage(
        chatId,
        [
          "The `/money` command does not take arguments.",
          "",
          "Usage:",
          "`/money`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    if (/^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const bank = getBankBalance();
      const debt = getTotalLiabilities();
      const netWorth = getNetWorth();
      const recurringNet = getRecurringMonthlyNet();

      const debtRows = getDebtRows();
      const debtMonths = simulateDebtPayoffMonths(
        debtRows,
        "avalanche",
        Math.max(0, recurringNet)
      );

      const monthlyExpenses = getMonthlyExpenses();
      const annualExpenses = monthlyExpenses * 12;
      const fiTarget = annualExpenses > 0 ? annualExpenses * 25 : 0;
      const fiMonths = simulateFIMonths(
        bank,
        Math.max(0, recurringNet),
        7,
        fiTarget
      );

      let debtText;
      if (debtRows.length === 0) {
        debtText = "Already debt-free";
      } else if (debtMonths == null) {
        debtText = ">100 years";
      } else {
        debtText = futureMonthLabel(debtMonths);
      }

      let fiText;
      if (fiTarget <= 0 || fiMonths == null) {
        fiText = "unavailable";
      } else {
        fiText = futureMonthLabel(fiMonths);
      }

      const out = [
        "💰 *Money*",
        "",
        codeBlock([
          `Bank           ${formatMoney(bank)}`,
          `Debt           ${formatMoney(debt)}`,
          `Net Worth      ${signedMoney(netWorth)}`,
          `Recurring Net  ${signedMoney(recurringNet, "/mo")}`,
          `Debt Free      ${debtText}`,
          `FI             ${fiText}`
        ].join("\n"))
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("money error:", err);
      return bot.sendMessage(chatId, "Error generating money snapshot.");
    }
  });
};

module.exports.help = {
  command: "money",
  category: "Reporting",
  summary: "Show a compact financial snapshot including bank balance, debt, net worth, recurring net, debt-free estimate, and FI estimate.",
  usage: [
    "/money"
  ],
  examples: [
    "/money"
  ],
  notes: [
    "Balances come from `ledgerService.getBalances()`.",
    "Recurring net is estimated from `recurring_transactions`.",
    "FI estimate uses current month expenses and a 7% annual return assumption."
  ]
};
