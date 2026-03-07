// handlers/caniafford.js
module.exports = function registerCanIAffordHandler(bot, deps) {
  const { db, simulateCashflow } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  bot.onText(/^\/caniafford(@\w+)?\s+(\d+(\.\d+)?)$/i, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const amount = Number(match[2]);

      if (!Number.isFinite(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "Usage: /caniafford <amount>");
      }

      const checking = db.prepare(`
        SELECT id
        FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(chatId, "Checking account assets:bank not found.");
      }

      const row = db.prepare(`
        SELECT IFNULL(SUM(amount), 0) as balance
        FROM postings
        WHERE account_id = ?
      `).get(checking.id);

      const currentBalance = Number(row?.balance) || 0;

      const baseline = simulateCashflow(db, currentBalance, checking.id, 30);
      const baselineTimeline = Array.isArray(baseline?.timeline) ? baseline.timeline : [];

      let baselineMin = currentBalance;
      for (const evt of baselineTimeline) {
        const b = Number(evt.balance) || 0;
        if (b < baselineMin) baselineMin = b;
      }

      const startingAfterPurchase = currentBalance - amount;
      const purchaseRun = simulateCashflow(db, startingAfterPurchase, checking.id, 30);
      const purchaseTimeline = Array.isArray(purchaseRun?.timeline) ? purchaseRun.timeline : [];

      let projectedMin = startingAfterPurchase;
      let firstNegativeDate = null;

      for (const evt of purchaseTimeline) {
        const b = Number(evt.balance) || 0;

        if (b < projectedMin) projectedMin = b;
        if (firstNegativeDate == null && b < 0) {
          firstNegativeDate = evt.date;
        }
      }

      if (firstNegativeDate == null && startingAfterPurchase < 0) {
        firstNegativeDate = "today";
      }

      const deltaMin = projectedMin - baselineMin;
      const affordableNow = startingAfterPurchase >= 0;
      const createsOverdraftRisk = projectedMin < 0;

      let verdict;
      if (affordableNow && !createsOverdraftRisk) {
        verdict = "✅ Yes — this looks affordable.";
      } else if (affordableNow && createsOverdraftRisk) {
        verdict = "⚠️ Maybe — you can pay it now, but it creates 30-day overdraft risk.";
      } else {
        verdict = "❌ No — this would put your bank balance negative immediately.";
      }

      let out = "🛒 Can I Afford It?\n\n";
      out += "```\n";
      out += `Purchase:            ${money(amount)}\n`;
      out += `Current Balance:     ${money(currentBalance)}\n`;
      out += `Balance After Buy:   ${money(startingAfterPurchase)}\n`;
      out += `30d Min (before):    ${money(baselineMin)}\n`;
      out += `30d Min (after):     ${money(projectedMin)}\n`;
      out += `Change in 30d Min:   ${deltaMin >= 0 ? "+" : "-"}${money(Math.abs(deltaMin))}\n`;
      if (firstNegativeDate) {
        out += `First Negative:      ${firstNegativeDate}\n`;
      }
      out += "```";
      out += `\n${verdict}`;

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("caniafford error:", err);
      return bot.sendMessage(chatId, "Error calculating affordability.");
    }
  });
};
