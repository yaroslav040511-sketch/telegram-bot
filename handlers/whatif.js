// handlers/whatif.js
module.exports = function registerWhatIfHandler(bot, deps) {
  const { db, simulateCashflow, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/whatif*",
      "Simulate the impact of a one-time spend on your 30-day bank balance forecast.",
      "",
      "*Usage*",
      "- `/whatif <amount>`",
      "",
      "*Arguments*",
      "- `<amount>` — Hypothetical spend amount. Must be zero or greater.",
      "",
      "*Examples*",
      "- `/whatif 50`",
      "- `/whatif 299.99`",
      "- `/whatif 1200`",
      "",
      "*Notes*",
      "- Uses `assets:bank` only, because this is a liquidity scenario.",
      "- Runs a 30-day cashflow forecast after subtracting the hypothetical spend."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/whatif(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const spend = Number(raw);

      if (!Number.isFinite(spend) || spend < 0) {
        return bot.sendMessage(
          chatId,
          [
            "Spend amount must be zero or greater.",
            "",
            "Usage:",
            "`/whatif <amount>`",
            "",
            "Example:",
            "`/whatif 50`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const checking = db
        .prepare(`SELECT id FROM accounts WHERE name = 'assets:bank'`)
        .get();

      if (!checking) {
        return bot.sendMessage(chatId, "assets:bank account not found.");
      }

      const row = db
        .prepare(`
          SELECT IFNULL(SUM(amount), 0) as balance
          FROM postings
          WHERE account_id = ?
        `)
        .get(checking.id);

      const currentBalance = Number(row?.balance) || 0;

      const result = simulateCashflow(
        db,
        currentBalance - spend,
        checking.id,
        30
      );

      let firstNegativeDate = null;
      if (Array.isArray(result?.timeline)) {
        const negative = result.timeline.find((e) => Number(e.balance) < 0);
        if (negative) firstNegativeDate = negative.date;
      }

      if (firstNegativeDate == null && currentBalance - spend < 0) {
        firstNegativeDate = "today";
      }

      const lowestBalance = Number(result?.lowestBalance);
      const safeLowest = Number.isFinite(lowestBalance)
        ? lowestBalance
        : currentBalance - spend;

      const lines = [
        "💸 *What-If Spend*",
        "",
        codeBlock([
          `Hypothetical Spend  ${formatMoney(spend)}`,
          `Starting Balance    ${formatMoney(currentBalance)}`,
          `Balance After Spend ${formatMoney(currentBalance - spend)}`,
          `Lowest 30d Balance  ${formatMoney(safeLowest)}`,
          ...(firstNegativeDate ? [`First Negative    ${firstNegativeDate}`] : [])
        ].join("\n"))
      ];

      if (firstNegativeDate) {
        lines.push("⚠️ Overdraft risk detected in the next 30 days.");
      } else {
        lines.push("✅ No overdraft risk in the next 30 days.");
      }

      return bot.sendMessage(chatId, lines.join("\n"), {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("What-if error:", err);
      return bot.sendMessage(chatId, "Simulation failed.");
    }
  });
};

module.exports.help = {
  command: "whatif",
  category: "Forecasting",
  summary: "Simulate the impact of a one-time spend on your 30-day bank balance forecast.",
  usage: [
    "/whatif <amount>"
  ],
  args: [
    { name: "<amount>", description: "Hypothetical spend amount. Must be zero or greater." }
  ],
  examples: [
    "/whatif 50",
    "/whatif 299.99",
    "/whatif 1200"
  ],
  notes: [
    "Uses `assets:bank` only, because this is a liquidity scenario.",
    "Runs a 30-day cashflow forecast after subtracting the hypothetical spend."
  ]
};
