// handlers/goal.js
module.exports = function registerGoalHandler(bot, deps) {
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

  bot.onText(/^\/goal(@\w+)?\s+(.+?)\s+(\d+(\.\d+)?)$/i, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const name = String(match[2] || "").trim().replace(/^["']|["']$/g, "");
      const target = Number(match[3]);

      if (!name) {
        return bot.sendMessage(chatId, "Usage: /goal <name> <amount>\nExample: /goal laptop 1200");
      }

      if (!Number.isFinite(target) || target <= 0) {
        return bot.sendMessage(chatId, "Goal amount must be greater than 0.");
      }

      const cash = getBankBalance();
      const recurringNet = getRecurringMonthlyNet();

      const alreadyCovered = cash >= target;
      const gap = Math.max(0, target - cash);

      let etaText = "already funded";
      if (!alreadyCovered) {
        if (recurringNet > 0) {
          const months = Math.ceil(gap / recurringNet);
          etaText = `${months} month(s) (${futureMonthLabel(months)})`;
        } else {
          etaText = "unavailable";
        }
      }

      let verdict;
      if (alreadyCovered) {
        verdict = "✅ You can already afford this goal.";
      } else if (recurringNet > 0) {
        verdict = "🟡 Goal is reachable with your current recurring surplus.";
      } else {
        verdict = "⚠️ Goal is not currently reachable from recurring surplus.";
      }

      let out = "🎯 Goal Projection\n\n";
      out += "```\n";
      out += `Goal:             ${name}\n`;
      out += `Target Amount:    ${money(target)}\n`;
      out += `Cash on Hand:     ${money(cash)}\n`;
      out += `Recurring Surplus:${recurringNet >= 0 ? "+" : "-"}${money(Math.abs(recurringNet))}\n`;
      out += `Gap:              ${money(gap)}\n`;
      out += `ETA:              ${etaText}\n`;
      out += "```";
      out += `\n${verdict}`;

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("goal error:", err);
      return bot.sendMessage(chatId, "Error calculating goal.");
    }
  });
};
