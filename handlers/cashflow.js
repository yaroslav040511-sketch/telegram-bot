// handlers/cashflow.js
module.exports = function registerCashflowHandler(bot, deps) {
  const { db, format, finance } = deps;
  const { formatMoney, codeBlock } = format;
  const { getRecurringMonthlyNet } = finance;

  function renderHelp() {
    return [
      "*\\/cashflow*",
      "Show recurring monthly income versus recurring monthly bills.",
      "",
      "*Usage*",
      "- `/cashflow`",
      "",
      "*Examples*",
      "- `/cashflow`"
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), { parse_mode: "Markdown" });
  }

  bot.onText(/^\/cashflow(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/cashflow` command does not take arguments.",
          "",
          "Usage:",
          "`/cashflow`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const rows = db.prepare(`
        SELECT id, description, postings_json, frequency
        FROM recurring_transactions
        ORDER BY id ASC
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No recurring items saved yet.");
      }

      const recurring = getRecurringMonthlyNet(db);
      const net = recurring.net;

      const out = [
        "📊 *Monthly Cashflow (Recurring)*",
        "",
        codeBlock([
          `Recurring Income  ${formatMoney(recurring.income)}`,
          `Recurring Bills   ${formatMoney(recurring.bills)}`,
          `Net Monthly       ${net >= 0 ? "+" : "-"}${formatMoney(Math.abs(net))}`
        ].join("\n"))
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Cashflow error:", err);
      return bot.sendMessage(chatId, "Error calculating cashflow.");
    }
  });
};

module.exports.help = {
  command: "cashflow",
  category: "General",
  summary: "Recurring monthly income vs bills.",
  usage: [
    "/cashflow"
  ],
  examples: [
    "/cashflow"
  ]
};
