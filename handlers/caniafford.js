// handlers/caniafford.js
module.exports = function registerCanIAffordHandler(bot, deps) {
  const { db, simulateCashflow, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/caniafford*",
      "Estimate whether a purchase is safe based on your current bank balance and 30-day cashflow projection.",
      "",
      "*Usage*",
      "- `/caniafford <amount>`",
      "",
      "*Arguments*",
      "- `<amount>` — Purchase amount. Must be greater than 0.",
      "",
      "*Examples*",
      "- `/caniafford 50`",
      "- `/caniafford 299.99`",
      "- `/caniafford 1200`",
      "",
      "*Notes*",
      "- Uses `assets:bank` only, because this is a liquidity check.",
      "- Compares your projected 30-day minimum balance before and after the purchase."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/caniafford(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const amount = Number(raw);

      if (!Number.isFinite(amount) || amount <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "Purchase amount must be greater than 0.",
            "",
            "Usage:",
            "`/caniafford <amount>`",
            "",
            "Example:",
            "`/caniafford 299.99`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const checking = db.prepare(`
        SELECT id
        FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(
          chatId,
          "Checking account `assets:bank` not found.",
          { parse_mode: "Markdown" }
        );
      }

      const row = db.prepare(`
        SELECT IFNULL(SUM(amount), 0) as balance
        FROM postings
        WHERE account_id = ?
      `).get(checking.id);

      const currentBalance = Number(row?.balance) || 0;

      const baseline = simulateCashflow(db, currentBalance, checking.id, 30);
      const baselineTimeline = Array.isArray(baseline?.timeline)
        ? baseline.timeline
        : [];

      let baselineMin = currentBalance;
      for (const evt of baselineTimeline) {
        const b = Number(evt.balance) || 0;
        if (b < baselineMin) baselineMin = b;
      }

      const startingAfterPurchase = currentBalance - amount;
      const purchaseRun = simulateCashflow(db, startingAfterPurchase, checking.id, 30);
      const purchaseTimeline = Array.isArray(purchaseRun?.timeline)
        ? purchaseRun.timeline
        : [];

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

      const lines = [
        "🛒 *Can I Afford It?*",
        "",
        codeBlock([
          `Purchase            ${formatMoney(amount)}`,
          `Current Balance     ${formatMoney(currentBalance)}`,
          `Balance After Buy   ${formatMoney(startingAfterPurchase)}`,
          `30d Min (before)    ${formatMoney(baselineMin)}`,
          `30d Min (after)     ${formatMoney(projectedMin)}`,
          `Change in 30d Min   ${deltaMin >= 0 ? "+" : "-"}${formatMoney(Math.abs(deltaMin))}`,
          ...(firstNegativeDate ? [`First Negative      ${firstNegativeDate}`] : [])
        ].join("\n")),
        verdict
      ];

      return bot.sendMessage(chatId, lines.join("\n"), {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("caniafford error:", err);
      return bot.sendMessage(chatId, "Error calculating affordability.");
    }
  });
};

module.exports.help = {
  command: "caniafford",
  category: "Forecasting",
  summary: "Estimate whether a purchase is safe based on your current bank balance and 30-day cashflow projection.",
  usage: [
    "/caniafford <amount>"
  ],
  args: [
    { name: "<amount>", description: "Purchase amount. Must be greater than 0." }
  ],
  examples: [
    "/caniafford 50",
    "/caniafford 299.99",
    "/caniafford 1200"
  ],
  notes: [
    "Uses `assets:bank` only, because this is a liquidity check.",
    "Compares your projected 30-day minimum balance before and after the purchase."
  ]
};
