// handlers/autopilot.js
module.exports = function registerAutopilotHandler(bot, deps) {
  const { db, simulateCashflow, ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  function getRecurringMonthlyNet() {
    const rows = db.prepare(`
      SELECT postings_json, frequency
      FROM recurring_transactions
    `).all();

    let income = 0;
    let bills = 0;

    function monthlyMultiplier(freq) {
      switch ((freq || "").toLowerCase()) {
        case "daily": return 30;
        case "weekly": return 4.33;
        case "monthly": return 1;
        case "yearly": return 1 / 12;
        default: return 0;
      }
    }

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

  function cloneDebts(rows) {
    return rows.map((r) => ({ ...r }));
  }

  function sortDebts(debts, mode) {
    if (mode === "snowball") {
      debts.sort((a, b) => {
        const balDiff = a.balance - b.balance;
        if (balDiff !== 0) return balDiff;
        return b.apr - a.apr;
      });
    } else {
      debts.sort((a, b) => {
        const aprDiff = b.apr - a.apr;
        if (aprDiff !== 0) return aprDiff;
        return a.balance - b.balance;
      });
    }
  }

  function activeDebts(debts) {
    return debts.filter((d) => d.balance > 0.005);
  }

  function runDebtSimulation(rows, mode, extra) {
    const debts = cloneDebts(rows);

    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const monthlyBudget = totalMinimums + extra;

    if (monthlyBudget <= 0) {
      return { months: null, interest: null };
    }

    let months = 0;
    let totalInterest = 0;

    while (activeDebts(debts).length > 0 && months < 1200) {
      months += 1;

      for (const d of debts) {
        if (d.balance <= 0.005) continue;
        const monthlyRate = d.apr / 100 / 12;
        const interest = d.balance * monthlyRate;
        d.balance += interest;
        totalInterest += interest;
      }

      const remaining = activeDebts(debts);
      sortDebts(remaining, mode);

      let paymentPool = monthlyBudget;

      for (const d of remaining) {
        if (paymentPool <= 0) break;
        const minPay = Math.min(d.minimum, d.balance, paymentPool);
        d.balance -= minPay;
        paymentPool -= minPay;
      }

      let targets = activeDebts(debts);
      sortDebts(targets, mode);

      while (paymentPool > 0 && targets.length > 0) {
        const target = targets[0];
        const pay = Math.min(target.balance, paymentPool);
        target.balance -= pay;
        paymentPool -= pay;

        targets = activeDebts(debts);
        sortDebts(targets, mode);
      }

      for (const d of debts) {
        if (d.balance < 0.005) d.balance = 0;
      }
    }

    if (months >= 1200) {
      return { months: null, interest: null };
    }

    return { months, interest: totalInterest };
  }

  function chooseBestExtra(debtRows, monthlyNet, lowestAhead, bank, savings) {
    if (!debtRows.length || monthlyNet <= 0) return null;

    // conservative cap if cash is tight
    let safeCap = monthlyNet;

    if (lowestAhead < 100) {
      safeCap = Math.min(safeCap, 0);
    } else if (lowestAhead < 250) {
      safeCap = Math.min(safeCap, 100);
    } else if (lowestAhead < 500) {
      safeCap = Math.min(safeCap, 200);
    } else if (savings < 250) {
      safeCap = Math.min(safeCap, 200);
    } else {
      safeCap = Math.min(safeCap, 500);
    }

    if (safeCap < 50) return null;

    const start = 50;
    const step = 50;
    const end = Math.max(start, Math.floor(safeCap / step) * step);

    const points = [];
    for (let extra = start; extra <= end; extra += step) {
      const ava = runDebtSimulation(debtRows, "avalanche", extra);
      if (ava.months == null || ava.interest == null) continue;
      points.push({
        extra,
        months: ava.months,
        interest: ava.interest
      });
    }

    if (points.length < 2) {
      return points[0]?.extra || null;
    }

    let bestJump = null;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      const monthsSaved = prev.months - curr.months;
      const interestSaved = prev.interest - curr.interest;

      const score = (monthsSaved * 100) + interestSaved / 10;

      const jump = {
        from: prev.extra,
        to: curr.extra,
        monthsSaved,
        interestSaved,
        score
      };

      if (!bestJump || jump.score > bestJump.score) {
        bestJump = jump;
      }
    }

    return bestJump ? bestJump.to : points[0].extra;
  }

  bot.onText(/^\/autopilot(@\w+)?$/i, (msg) => {
    const chatId = msg.chat.id;

    try {
      const balances = ledgerService.getBalances();

      let bank = 0;
      let savings = 0;

      for (const b of balances) {
        if (b.account === "assets:bank") bank = Number(b.balance) || 0;
        if (b.account === "assets:savings") savings = Number(b.balance) || 0;
      }

      const checking = db.prepare(`
        SELECT id
        FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(chatId, "Checking account not found.");
      }

      const sim = simulateCashflow(db, bank, checking.id, 30);
      const lowest = Number(sim.lowestBalance) || 0;

      const debtRows = getDebtRows();
      const debt = debtRows.reduce((sum, d) => sum + d.balance, 0);
      const monthlyNet = getRecurringMonthlyNet();

      const recommendedExtra = chooseBestExtra(
        debtRows,
        monthlyNet,
        lowest,
        bank,
        savings
      );

      let mode;
      let reason;
      let action;
      let nextStep = "";

      if (lowest < 0) {
        mode = "Emergency Cash Defense";
        reason = `Projected lowest balance is ${money(lowest)}.`;
        action = "Pause extra debt payments and cut discretionary spending immediately.";
        nextStep = "Use /danger and /untilpayday to manage the risk window.";
      } else if (lowest < 100) {
        mode = "Preserve Cash";
        reason = `Projected lowest balance is only ${money(lowest)} before next income.`;
        action = "Avoid extra spending until payday and keep cash in checking.";
        nextStep = "Recheck /untilpayday after the next income lands.";
      } else if (debt > 0 && monthlyNet > 0) {
        mode = "Attack Debt";
        reason = `You have ${money(debt)} in debt and positive recurring cashflow.`;
        if (recommendedExtra) {
          action = `Recommended extra debt payment: ${money(recommendedExtra)} per month toward highest APR debt.`;
        } else {
          action = "Direct available surplus toward highest APR debt.";
        }
        nextStep = "Use /best_extra and /debt_compare_range_graph for fine tuning.";
      } else if (savings < 1000) {
        mode = "Build Emergency Fund";
        reason = `Savings are only ${money(savings)}.`;
        action = "Build a starter emergency fund before making aggressive long-term moves.";
        nextStep = "Use /emergency_fund to track your target.";
      } else {
        mode = "Grow Wealth";
        reason = "Cashflow is positive, your near-term risk is controlled, and debt pressure is low.";
        action = "Keep investing or saving your monthly surplus toward long-term goals.";
        nextStep = "Use /rich and /future to monitor long-term trajectory.";
      }

      let out = "🤖 Autopilot\n\n";
      out += "```\n";
      out += `Mode:           ${mode}\n`;
      out += `Bank:           ${money(bank)}\n`;
      out += `Savings:        ${money(savings)}\n`;
      out += `Debt:           ${money(debt)}\n`;
      out += `Monthly Net:    ${monthlyNet >= 0 ? "+" : "-"}${money(Math.abs(monthlyNet))}\n`;
      out += `Lowest Ahead:   ${money(lowest)}\n`;
      if (recommendedExtra) {
        out += `Best Extra:     ${money(recommendedExtra)}\n`;
      }
      out += "---------------------------\n";
      out += `Reason: ${reason}\n`;
      out += `Action: ${action}\n`;
      out += "```";

      if (nextStep) {
        out += `\n${nextStep}`;
      }

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("autopilot error:", err);
      return bot.sendMessage(chatId, "Autopilot error.");
    }
  });
};
