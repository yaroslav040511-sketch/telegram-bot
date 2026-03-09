// handlers/autopilot.js
module.exports = function registerAutopilotHandler(bot, deps) {
  const { db, simulateCashflow, ledgerService, format, finance } = deps;
  const { formatMoney, codeBlock } = format;
  const {
    getStartingAssets,
    getRecurringMonthlyNet,
    getDebtRows
  } = finance;

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

  function chooseBestExtra(debtRows, monthlyNet, lowestAhead, savings) {
    if (!debtRows.length || monthlyNet <= 0) return null;

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

    if (points.length === 0) return null;
    if (points.length === 1) return points[0].extra;

    let bestJump = null;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      const monthsSaved = prev.months - curr.months;
      const interestSaved = prev.interest - curr.interest;
      const score = (monthsSaved * 100) + (interestSaved / 10);

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

  function findTargetDebt(debtRows) {
    if (!debtRows.length) return null;

    const sorted = [...debtRows].sort((a, b) => {
      const aprDiff = b.apr - a.apr;
      if (aprDiff !== 0) return aprDiff;
      return a.balance - b.balance;
    });

    return sorted[0];
  }

  function renderHelp() {
    return [
      "*\\/autopilot*",
      "AI financial recommendation engine.",
      "",
      "*Usage*",
      "- `/autopilot`",
      "",
      "*Examples*",
      "- `/autopilot`",
      "",
      "*Notes*",
      "- Prioritizes cash defense first, then debt payoff, then emergency savings, then long-term growth."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/autopilot(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/autopilot` command does not take arguments.",
          "",
          "Usage:",
          "`/autopilot`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const starting = getStartingAssets(ledgerService);
      const bank = starting.bank;
      const savings = starting.savings;

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

      const debtRows = getDebtRows(db);
      const targetDebt = findTargetDebt(debtRows);
      const debt = debtRows.reduce((sum, d) => sum + d.balance, 0);
      const recurring = getRecurringMonthlyNet(db);
      const monthlyNet = recurring.net;

      const recommendedExtra = chooseBestExtra(
        debtRows,
        monthlyNet,
        lowest,
        savings
      );

      let mode;
      let reason;
      let action;
      let nextStep = "";

      if (lowest < 0) {
        mode = "Emergency Cash Defense";
        reason = `Projected lowest balance is ${formatMoney(lowest)}.`;
        action = "Pause extra debt payments and cut discretionary spending immediately.";
        nextStep = "Use /danger and /untilpayday to manage the risk window.";
      } else if (lowest < 100) {
        mode = "Preserve Cash";
        reason = `Projected lowest balance is only ${formatMoney(lowest)} before next income.`;
        action = "Avoid extra spending until payday and keep cash in checking.";
        nextStep = "Recheck /untilpayday after the next income lands.";
      } else if (debt > 0 && monthlyNet > 0) {
        mode = "Attack Debt";
        reason = `You have ${formatMoney(debt)} in debt and positive recurring cashflow.`;

        if (targetDebt && recommendedExtra) {
          action =
            `Target: ${targetDebt.name} (${targetDebt.apr}% APR)\n` +
            `Recommended extra payment: ${formatMoney(recommendedExtra)} per month.`;
        } else if (targetDebt) {
          action =
            `Target: ${targetDebt.name} (${targetDebt.apr}% APR)\n` +
            `Direct available surplus toward this debt.`;
        } else {
          action = "Direct available surplus toward highest APR debt.";
        }

        nextStep = "Use /best_extra and /debt_compare_range_graph for fine tuning.";
      } else if (savings < 1000) {
        mode = "Build Emergency Fund";
        reason = `Savings are only ${formatMoney(savings)}.`;
        action = "Build a starter emergency fund before making aggressive long-term moves.";
        nextStep = "Use /emergency_fund to track your target.";
      } else {
        mode = "Grow Wealth";
        reason = "Cashflow is positive, your near-term risk is controlled, and debt pressure is low.";
        action = "Keep investing or saving your monthly surplus toward long-term goals.";
        nextStep = "Use /rich and /future to monitor long-term trajectory.";
      }

      const lines = [
        "🤖 *Autopilot*",
        "",
        codeBlock([
          `Mode         ${mode}`,
          `Bank         ${formatMoney(bank)}`,
          `Savings      ${formatMoney(savings)}`,
          `Debt         ${formatMoney(debt)}`,
          `Monthly Net  ${monthlyNet >= 0 ? "+" : "-"}${formatMoney(Math.abs(monthlyNet))}`,
          `Lowest Ahead ${formatMoney(lowest)}`,
          ...(recommendedExtra ? [`Best Extra   ${formatMoney(recommendedExtra)}`] : [])
        ].join("\n")),
        `Reason: ${reason}`,
        `Action: ${action}`
      ];

      if (nextStep) {
        lines.push(nextStep);
      }

      return bot.sendMessage(chatId, lines.join("\n"), {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("autopilot error:", err);
      return bot.sendMessage(chatId, "Autopilot error.");
    }
  });
};

module.exports.help = {
  command: "autopilot",
  category: "General",
  summary: "AI financial recommendation engine.",
  usage: [
    "/autopilot"
  ],
  examples: [
    "/autopilot"
  ],
  notes: [
    "Prioritizes cash defense first, then debt payoff, then emergency savings, then long-term growth."
  ]
};
