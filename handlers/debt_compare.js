// handlers/debt_compare.js
module.exports = function registerDebtCompareHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, renderTable, codeBlock } = format;

  function cloneDebts(rows) {
    return rows.map((r) => ({
      name: String(r.name || ""),
      balance: Number(r.balance) || 0,
      apr: Number(r.apr) || 0,
      minimum: Number(r.minimum) || 0,
      interestPaid: 0
    }));
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

  function runSimulation(rows, mode, extra) {
    const debts = cloneDebts(rows);

    const startingDebt = debts.reduce((sum, d) => sum + d.balance, 0);
    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const monthlyBudget = totalMinimums + extra;

    if (monthlyBudget <= 0) {
      throw new Error("Monthly debt budget must be greater than 0.");
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
        d.interestPaid += interest;
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
      throw new Error("Simulation exceeded safe limit. Budget may be too low.");
    }

    return {
      startingDebt,
      totalMinimums,
      monthlyBudget,
      months,
      totalInterest
    };
  }

  function renderHelp() {
    return [
      "*\\/debt_compare*",
      "Compare snowball and avalanche debt payoff strategies using the same extra monthly payment.",
      "",
      "*Usage*",
      "- `/debt_compare <extra>`",
      "",
      "*Arguments*",
      "- `<extra>` — Extra monthly payment on top of minimums. Must be zero or greater.",
      "",
      "*Examples*",
      "- `/debt_compare 100`",
      "- `/debt_compare 250.50`",
      "",
      "*Notes*",
      "- Compares payoff time and total interest.",
      "- Uses your current debts table."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debt_compare(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const extra = Number(raw);

      if (!Number.isFinite(extra) || extra < 0) {
        return bot.sendMessage(
          chatId,
          [
            "Extra payment must be zero or greater.",
            "",
            "Usage:",
            "`/debt_compare <extra>`",
            "",
            "Example:",
            "`/debt_compare 100`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      const snowball = runSimulation(rows, "snowball", extra);
      const avalanche = runSimulation(rows, "avalanche", extra);

      const interestSaved = snowball.totalInterest - avalanche.totalInterest;
      const monthsSaved = snowball.months - avalanche.months;

      let winnerText = "";
      if (avalanche.totalInterest < snowball.totalInterest) {
        winnerText = `Avalanche saves ${formatMoney(interestSaved)} in interest`;
      } else if (snowball.totalInterest < avalanche.totalInterest) {
        winnerText = `Snowball saves ${formatMoney(Math.abs(interestSaved))} in interest`;
      } else {
        winnerText = "Both strategies cost the same in interest";
      }

      if (monthsSaved > 0) {
        winnerText += ` and pays off ${monthsSaved} month(s) sooner.`;
      } else if (monthsSaved < 0) {
        winnerText += ` but takes ${Math.abs(monthsSaved)} more month(s).`;
      } else {
        winnerText += " with the same payoff time.";
      }

      const out = [
        "💳 *Debt Compare*",
        "",
        codeBlock([
          `Extra Payment   ${formatMoney(extra)}`,
          `Starting Debt   ${formatMoney(snowball.startingDebt)}`,
          `Min Payments    ${formatMoney(snowball.totalMinimums)}`,
          `Monthly Budget  ${formatMoney(snowball.monthlyBudget)}`
        ].join("\n")),
        renderTable(
          ["Strategy", "Months", "Interest"],
          [
            ["Snowball", String(snowball.months), formatMoney(snowball.totalInterest)],
            ["Avalanche", String(avalanche.months), formatMoney(avalanche.totalInterest)]
          ],
          { aligns: ["left", "right", "right"] }
        ),
        winnerText
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debt_compare error:", err);
      return bot.sendMessage(chatId, "Error comparing debt strategies.");
    }
  });
};

module.exports.help = {
  command: "debt_compare",
  category: "Debt",
  summary: "Compare snowball and avalanche debt payoff strategies using the same extra monthly payment.",
  usage: [
    "/debt_compare <extra>"
  ],
  args: [
    { name: "<extra>", description: "Extra monthly payment on top of minimums. Must be zero or greater." }
  ],
  examples: [
    "/debt_compare 100",
    "/debt_compare 250.50"
  ],
  notes: [
    "Compares payoff time and total interest.",
    "Uses your current debts table."
  ]
};
