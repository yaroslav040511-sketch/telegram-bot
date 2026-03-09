// handlers/next.js
module.exports = function registerNextHandler(bot, deps) {
  const { ledgerService, format, finance, db } = deps;
  const { formatMoney } = format;
  const { getRecurringMonthlyNet, getDebtRows, getStartingAssets } = finance;

  function highestAprDebt(debts) {
    if (!debts.length) return null;
    return [...debts].sort((a, b) => b.apr - a.apr)[0];
  }

  function renderHelp() {
    return [
      "*\\/next*",
      "Show the single recommended financial action right now.",
      "",
      "*Usage*",
      "- `/next`",
      "",
      "*Examples*",
      "- `/next`",
      "",
      "*Notes*",
      "- Prioritizes cash protection, then debt, then savings, then wealth-building."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), { parse_mode: "Markdown" });
  }

  bot.onText(/^\/next(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/next` command does not take arguments.",
          "",
          "Usage:",
          "`/next`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const starting = getStartingAssets(ledgerService);
      const bank = starting.bank;
      const savings = starting.savings;

      const debts = getDebtRows(db);
      const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
      const recurring = getRecurringMonthlyNet(db);
      const monthlyNet = recurring.net;
      const target = highestAprDebt(debts);

      let out = "🚀 Next Move\n\n";

      if (bank < 100) {
        out += "Protect cash immediately.\n\n";
        out += "Why:\n";
        out += "• Balance under $100\n";
        out += "• Risk of overdraft\n\n";
        out += "Action:\n";
        out += "Avoid discretionary spending.";
      } else if (totalDebt > 0 && monthlyNet > 0 && target) {
        const extra = Math.round(monthlyNet / 2);

        out += `Pay about ${formatMoney(extra)} toward ${target.name}.\n\n`;
        out += "Why:\n";
        out += `• Highest APR (${target.apr}%)\n`;
        out += `• Debt balance ${formatMoney(target.balance)}\n`;
        out += "• Monthly surplus available\n\n";
        out += "After that:\nRun /focus again.";
      } else if (savings < 1000 && monthlyNet > 0) {
        const save = Math.round(monthlyNet / 2);

        out += `Move about ${formatMoney(save)} to savings.\n\n`;
        out += "Why:\n";
        out += "• Emergency fund below $1000\n";
        out += "• Surplus cashflow available";
      } else if (monthlyNet > 0) {
        out += "Continue building wealth.\n\n";
        out += "Why:\n";
        out += "• Positive monthly surplus\n";
        out += "• Debt under control\n\n";
        out += "Consider investing surplus.";
      } else {
        out += "Review recurring expenses.\n\n";
        out += "Why:\n";
        out += "• Monthly surplus is small or negative";
      }

      return bot.sendMessage(chatId, out);
    } catch (err) {
      console.error("next error:", err);
      return bot.sendMessage(chatId, "Error generating next move.");
    }
  });
};

module.exports.help = {
  command: "next",
  category: "Forecasting",
  summary: "Single recommended financial action right now.",
  usage: [
    "/next"
  ],
  examples: [
    "/next"
  ],
  notes: [
    "Prioritizes cash protection, then debt, then savings, then wealth-building."
  ]
};
