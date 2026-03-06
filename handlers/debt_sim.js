// handlers/debt_sim.js
module.exports = function registerDebtSimHandler(bot, deps) {
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

  bot.onText(/^\/debt_sim\s+(snowball|avalanche)\s+(\d+(\.\d+)?)$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const mode = String(match[1] || "").toLowerCase();
    const extra = Number(match[2]);

    try {
      if (!Number.isFinite(extra) || extra < 0) {
        return bot.sendMessage(chatId, "Usage: /debt_sim <snowball|avalanche> <extra>");
      }

      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      const debts = cloneDebts(rows);
      const originalTotalDebt = debts.reduce((sum, d) => sum + d.balance, 0);
      const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
      const monthlyBudget = totalMinimums + extra;

      if (monthlyBudget <= 0) {
        return bot.sendMessage(chatId, "Monthly debt budget must be greater than 0.");
      }

      let months = 0;
      let totalInterest = 0;
      const payoffOrder = [];
      const payoffMoments = [];

      // safety cap: 100 years
      while (activeDebts(debts).length > 0 && months < 1200) {
        months += 1;

        // 1) accrue monthly interest
        for (const d of debts) {
          if (d.balance <= 0.005) continue;

          const monthlyRate = d.apr / 100 / 12;
          const interest = d.balance * monthlyRate;
          d.balance += interest;
          d.interestPaid += interest;
          totalInterest += interest;
        }

        // 2) sort remaining debts according to strategy
        const remaining = activeDebts(debts);
        sortDebts(remaining, mode);

        // 3) pay minimums first
        let paymentPool = monthlyBudget;

        for (const d of remaining) {
          if (paymentPool <= 0) break;

          const minPay = Math.min(d.minimum, d.balance, paymentPool);
          d.balance -= minPay;
          paymentPool -= minPay;
        }

        // 4) apply all extra leftover to target debt(s)
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

        // 5) record newly paid off debts
        for (const d of debts) {
          if (d.balance <= 0.005 && !payoffOrder.includes(d.name)) {
            d.balance = 0;
            payoffOrder.push(d.name);
            payoffMoments.push({ name: d.name, month: months });
          }
        }
      }

      if (months >= 1200) {
        return bot.sendMessage(chatId, "Simulation exceeded safe limit. Budget may be too low to pay off debts.");
      }

      let out = `💳 Debt Simulation (${mode})\n\n`;
      out += "```\n";
      out += `Starting Debt:      $${originalTotalDebt.toFixed(2)}\n`;
      out += `Minimum Payments:   $${totalMinimums.toFixed(2)}\n`;
      out += `Extra Payment:      $${extra.toFixed(2)}\n`;
      out += `Monthly Budget:     $${monthlyBudget.toFixed(2)}\n`;
      out += `Months to Payoff:   ${months}\n`;
      out += `Interest Paid:      $${totalInterest.toFixed(2)}\n`;
      out += "\n";
      out += "Payoff Order\n";
      out += "---------------------------------\n";

      for (const p of payoffMoments) {
        const name = String(p.name).padEnd(12);
        const when = (`month ${p.month}`).padStart(10);
        out += `${name}${when}\n`;
      }

      out += "```";

      if (mode === "snowball") {
        out += "\nSnowball favors momentum: smallest balance first.";
      } else {
        out += "\nAvalanche favors math: highest APR first.";
      }

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debt_sim error:", err);
      return bot.sendMessage(chatId, "Error running debt simulation.");
    }
  });
};
