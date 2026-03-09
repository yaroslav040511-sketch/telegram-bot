// handlers/debt_total.js
module.exports = function registerDebtTotalHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/debt_total*",
      "Show total debt, total minimum payments, and weighted APR across all debts.",
      "",
      "*Usage*",
      "- `/debt_total`",
      "",
      "*Examples*",
      "- `/debt_total`",
      "",
      "*Notes*",
      "- Weighted APR is balance-weighted across all recorded debts."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debt_total(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/debt_total` command does not take arguments.",
          "",
          "Usage:",
          "`/debt_total`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      let totalDebt = 0;
      let totalMinimum = 0;
      let weightedAprNumerator = 0;

      for (const row of rows) {
        const balance = Number(row.balance) || 0;
        const apr = Number(row.apr) || 0;
        const minimum = Number(row.minimum) || 0;

        totalDebt += balance;
        totalMinimum += minimum;
        weightedAprNumerator += balance * apr;
      }

      const weightedApr = totalDebt > 0
        ? weightedAprNumerator / totalDebt
        : 0;

      const out = [
        "💳 *Debt Summary*",
        "",
        codeBlock([
          `Total Debt       ${formatMoney(totalDebt)}`,
          `Total Minimums   ${formatMoney(totalMinimum)}`,
          `Weighted APR     ${weightedApr.toFixed(2)}%`
        ].join("\n"))
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debt_total error:", err);
      return bot.sendMessage(chatId, "Error calculating debt totals.");
    }
  });
};

module.exports.help = {
  command: "debt_total",
  category: "Debt",
  summary: "Show total debt, total minimum payments, and weighted APR across all debts.",
  usage: [
    "/debt_total"
  ],
  examples: [
    "/debt_total"
  ],
  notes: [
    "Weighted APR is balance-weighted across all recorded debts."
  ]
};
