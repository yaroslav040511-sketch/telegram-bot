// handlers/debt_plan.js
module.exports = function registerDebtPlanHandler(bot, deps) {
  const { db } = deps;

  bot.onText(/^\/debt_plan\s+(snowball|avalanche)\s+(\d+(\.\d+)?)$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const mode = String(match[1] || "").toLowerCase();
    const extra = Number(match[2]);

    try {
      if (!Number.isFinite(extra) || extra < 0) {
        return bot.sendMessage(chatId, "Usage: /debt_plan <snowball|avalanche> <extra>");
      }

      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      const debts = [...rows];

      if (mode === "snowball") {
        debts.sort((a, b) => {
          const balDiff = Number(a.balance) - Number(b.balance);
          if (balDiff !== 0) return balDiff;
          return Number(b.apr) - Number(a.apr);
        });
      }

      if (mode === "avalanche") {
        debts.sort((a, b) => {
          const aprDiff = Number(b.apr) - Number(a.apr);
          if (aprDiff !== 0) return aprDiff;
          return Number(a.balance) - Number(b.balance);
        });
      }

      let totalDebt = 0;
      let totalMinimum = 0;

      for (const d of debts) {
        totalDebt += Number(d.balance) || 0;
        totalMinimum += Number(d.minimum) || 0;
      }

      const totalMonthlyPayment = totalMinimum + extra;
      const target = debts[0];

      let out = `💳 Debt Plan (${mode})\n\n`;
      out += "```\n";
      out += `Total Debt:          $${totalDebt.toFixed(2)}\n`;
      out += `Total Minimums:      $${totalMinimum.toFixed(2)}\n`;
      out += `Extra Payment:       $${extra.toFixed(2)}\n`;
      out += `Monthly Debt Budget: $${totalMonthlyPayment.toFixed(2)}\n`;
      out += "\n";
      out += `Attack First:        ${target.name}\n`;
      out += "\n";
      out += "Order\n";
      out += "--------------------------------------\n";

      let i = 1;
      for (const d of debts) {
        const order = `${i}.`.padEnd(4);
        const name = String(d.name || "").padEnd(12);
        const bal = (`$${Number(d.balance).toFixed(2)}`).padStart(10);
        const apr = (`${Number(d.apr).toFixed(1)}%`).padStart(7);
        const min = (`$${Number(d.minimum).toFixed(2)}`).padStart(8);

        const marker = i === 1 ? "  <= extra goes here first" : "";
        out += `${order}${name}${bal}  ${apr}  ${min}${marker}\n`;
        i++;
      }

      out += "```";

      if (mode === "snowball") {
        out += "\nPay minimums on all debts, then put all extra toward the smallest balance first.";
      } else {
        out += "\nPay minimums on all debts, then put all extra toward the highest APR first.";
      }

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debt_plan error:", err);
      return bot.sendMessage(chatId, "Error calculating debt plan.");
    }
  });
};
