// handlers/rich.js
module.exports = function registerRichHandler(bot, deps) {
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

  function getDebtRows() {
    return db.prepare(`
      SELECT name, balance, apr, minimum
      FROM debts
    `).all().map((r) => ({
      name: r.name,
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

      // add recurring monthly surplus/deficit to cash first
      cash += monthlyNet;

      if (activeDebts().length > 0) {
        // accrue interest
        for (const d of debts) {
          if (d.balance <= 0.005) continue;
          const monthlyRate = d.apr / 100 / 12;
          d.balance += d.balance * monthlyRate;
        }

        // you can only pay what you actually have in cash
        let paymentPool = Math.max(0, Math.min(cash, targetDebtBudget));

        const remaining = activeDebts();
        sortDebts(remaining);

        // pay minimums first
        for (const d of remaining) {
          if (paymentPool <= 0) break;
          const minPay = Math.min(d.minimum, d.balance, paymentPool);
          d.balance -= minPay;
          paymentPool -= minPay;
          cash -= minPay;
        }

        // then avalanche extra
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

  bot.onText(/^\/rich(@\w+)?$/i, (msg) => {
    const chatId = msg.chat.id;

    try {
      const cash = getBankBalance();
      const monthlyNet = getRecurringMonthlyNet();
      const debtRows = getDebtRows();

      const totalDebt = debtRows.reduce((sum, d) => sum + d.balance, 0);
      const netWorthNow = cash - totalDebt;

      const targets = [50000, 100000, 250000, 500000, 1000000];
      const monthsMap = simulateMilestones(cash, monthlyNet, debtRows, targets);

      let out = "💸 Rich Timeline\n\n";
      out += "```\n";
      out += `Cash Now:         ${money(cash)}\n`;
      out += `Debt Now:         ${money(totalDebt)}\n`;
      out += `Net Worth Now:    ${netWorthNow >= 0 ? "+" : "-"}${money(Math.abs(netWorthNow))}\n`;
      out += `Recurring Net:    ${monthlyNet >= 0 ? "+" : "-"}${money(Math.abs(monthlyNet))}/mo\n`;
      out += "------------------------------\n";

      for (const target of targets) {
        const months = monthsMap[target];
        const label = `${money(target)}:`.padEnd(18);

        if (months == null) {
          out += `${label} >200 years\n`;
        } else {
          out += `${label} ${futureMonthLabel(months)}\n`;
        }
      }

      out += "```";

      let summary;
      if (monthsMap[1000000] != null) {
        summary = `At your current trajectory, $1M net worth lands around ${futureMonthLabel(monthsMap[1000000])}.`;
      } else if (monthsMap[100000] != null) {
        summary = `At your current trajectory, six figures lands around ${futureMonthLabel(monthsMap[100000])}.`;
      } else {
        summary = "Your trajectory is positive, but larger wealth milestones are still far out.";
      }

      return bot.sendMessage(chatId, out + "\n" + summary, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("rich error:", err);
      return bot.sendMessage(chatId, "Error generating rich timeline.");
    }
  });
};
