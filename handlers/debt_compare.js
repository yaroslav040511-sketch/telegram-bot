// handlers/debt_compare.js
module.exports = function registerDebtCompareHandler(bot, deps) {
  const { db } = deps;

  function cloneDebts(rows) {
    return rows.map((r) => ({
      name: r.name,
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

      // 1) accrue interest
      for (const d of debts) {
        if (d.balance <= 0.005) continue;

        const monthlyRate = d.apr / 100 / 12;
        const interest = d.balance * monthlyRate;
        d.balance += interest;
        d.interestPaid += interest;
        totalInterest += interest;
      }

      // 2) pay minimums
      const remaining = activeDebts(debts);
      sortDebts(remaining, mode);

      let paymentPool = monthlyBudget;

      for (const d of remaining) {
        if (paymentPool <= 0) break;

        const minPay = Math.min(d.minimum, d.balance, paymentPool);
        d.balance -= minPay;
        paymentPool -= minPay;
      }

      // 3) apply extra to target debt(s)
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

      // cleanup tiny negatives/rounding
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

  bot.onText(/^\/debt_compare\s+(\d+(\.\d+)?)$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const extra = Number(match[1]);

    try {
      if (!Number.isFinite(extra) || extra < 0) {
        return bot.sendMessage(chatId, "Usage: /debt_compare <extra>");
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
        winnerText = `Avalanche saves $${interestSaved.toFixed(2)} in interest`;
      } else if (snowball.totalInterest < avalanche.totalInterest) {
        winnerText = `Snowball saves $${Math.abs(interestSaved).toFixed(2)} in interest`;
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

      let out = "💳 Debt Compare\n\n";
      out += "```\n";
      out += `Extra Payment:   $${extra.toFixed(2)}\n`;
      out += `Starting Debt:   $${snowball.startingDebt.toFixed(2)}\n`;
      out += `Min Payments:    $${snowball.totalMinimums.toFixed(2)}\n`;
      out += `Monthly Budget:  $${snowball.monthlyBudget.toFixed(2)}\n`;
      out += "\n";
      out += "Strategy     Months   Interest\n";
      out += "-------------------------------\n";
      out += `Snowball     ${String(snowball.months).padStart(6)}   $${snowball.totalInterest.toFixed(2)}\n`;
      out += `Avalanche    ${String(avalanche.months).padStart(6)}   $${avalanche.totalInterest.toFixed(2)}\n`;
      out += "```";
      out += `\n${winnerText}`;

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debt_compare error:", err);
      return bot.sendMessage(chatId, "Error comparing debt strategies.");
    }
  });
};
