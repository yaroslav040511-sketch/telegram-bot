// handlers/debt_compare_range.js
module.exports = function registerDebtCompareRangeHandler(bot, deps) {
  const { db } = deps;

  function cloneDebts(rows) {
    return rows.map((r) => ({
      name: r.name,
      balance: Number(r.balance) || 0,
      apr: Number(r.apr) || 0,
      minimum: Number(r.minimum) || 0
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

    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const monthlyBudget = totalMinimums + extra;

    if (monthlyBudget <= 0) {
      throw new Error("Monthly budget must be greater than 0.");
    }

    let months = 0;
    let totalInterest = 0;

    while (activeDebts(debts).length > 0 && months < 1200) {
      months += 1;

      // interest
      for (const d of debts) {
        if (d.balance <= 0.005) continue;
        const monthlyRate = d.apr / 100 / 12;
        const interest = d.balance * monthlyRate;
        d.balance += interest;
        totalInterest += interest;
      }

      // minimums
      const remaining = activeDebts(debts);
      sortDebts(remaining, mode);

      let paymentPool = monthlyBudget;

      for (const d of remaining) {
        if (paymentPool <= 0) break;
        const minPay = Math.min(d.minimum, d.balance, paymentPool);
        d.balance -= minPay;
        paymentPool -= minPay;
      }

      // extra
      let targets = activeDebts(debts);
      sortDebts(targets, mode);

      while (paymentPool > 0 && targets.length > 0) {
        const target = targets[0];
        const pay = Math.min(target.balance, paymentPool);
        target.balance -= pay;
        paymentPool -= pay;

        targets = activeDebts(debts);
        sortDebts(targets);
      }

      for (const d of debts) {
        if (d.balance < 0.005) d.balance = 0;
      }
    }

    if (months >= 1200) {
      return { months: null, interest: null };
    }

    return {
      months,
      interest: totalInterest
    };
  }

  bot.onText(/^\/debt_compare_range\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)$/i, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const start = Number(match[1]);
      const end = Number(match[3]);
      const step = Number(match[5]);

      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) ||
        start < 0 || end < start || step <= 0) {
        return bot.sendMessage(chatId, "Usage: /debt_compare_range <start> <end> <step>\nExample: /debt_compare_range 100 500 100");
      }

      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      let out = "💳 Debt Compare Range\n\n";
      out += "```\n";
      out += "Extra   Snowball        Avalanche       Better\n";
      out += "-----------------------------------------------\n";

      for (let extra = start; extra <= end + 0.0001; extra += step) {
        const snow = runSimulation(rows, "snowball", extra);
        const ava = runSimulation(rows, "avalanche", extra);

        const extraText = `$${extra.toFixed(0)}`.padEnd(7);

        const snowText = snow.months == null
          ? ">100y".padEnd(15)
          : `${snow.months}m / $${snow.interest.toFixed(0)}`.padEnd(15);

        const avaText = ava.months == null
          ? ">100y".padEnd(15)
          : `${ava.months}m / $${ava.interest.toFixed(0)}`.padEnd(15);

        let better = "same";
        if (snow.months != null && ava.months != null) {
          if (ava.interest + 0.005 < snow.interest) better = "avalanche";
          else if (snow.interest + 0.005 < ava.interest) better = "snowball";
        }

        out += `${extraText}${snowText}${avaText}${better}\n`;
      }

      out += "```";

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debt_compare_range error:", err);
      return bot.sendMessage(chatId, "Error comparing debt strategies across range.");
    }
  });
};
