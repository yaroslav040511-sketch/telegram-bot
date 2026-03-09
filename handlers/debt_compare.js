const hledger = require("hledger/lib");

// handlers/debt_compare.js
module.exports = function registerDebtCompareHandler(bot, deps) {
  const { db, format, debt } = deps;
  const { formatMoney, renderTable, codeBlock } = format;
  const { getDebtRows, runDebtSimulation } = debt;
  hledger

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

      const rows = getDebtRows(db);

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      const snowball = runDebtSimulation(rows, "snowball", extra);
      const avalanche = runDebtSimulation(rows, "avalanche", extra);

      if (
        snowball.months == null || snowball.interest == null ||
        avalanche.months == null || avalanche.interest == null
      ) {
        return bot.sendMessage(
          chatId,
          "Simulation exceeded safe limit. Budget may be too low."
        );
      }

      const interestSaved = snowball.interest - avalanche.interest;
      const monthsSaved = snowball.months - avalanche.months;

      let winnerText = "";
      if (avalanche.interest < snowball.interest) {
        winnerText = `Avalanche saves ${formatMoney(interestSaved)} in interest`;
      } else if (snowball.interest < avalanche.interest) {
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
            ["Snowball", String(snowball.months), formatMoney(snowball.interest)],
            ["Avalanche", String(avalanche.months), formatMoney(avalanche.interest)]
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
