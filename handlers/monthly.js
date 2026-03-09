// handlers/monthly.js
module.exports = function registerMonthlyHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/monthly*",
      "This month's income, expenses, and net.",
      "",
      "*Usage*",
      "- `/monthly`",
      "",
      "*Examples*",
      "- `/monthly`"
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/monthly(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/monthly` command does not take arguments.",
          "",
          "Usage:",
          "`/monthly`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const rows = db.prepare(`
        SELECT
          a.type as type,
          SUM(p.amount) as total
        FROM transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
          AND (a.type = 'INCOME' OR a.type = 'EXPENSES')
        GROUP BY a.type
      `).all();

      let income = 0;
      let expenses = 0;

      for (const r of rows) {
        const v = Math.abs(Number(r.total) || 0);
        if (r.type === "INCOME") income = v;
        if (r.type === "EXPENSES") expenses = v;
      }

      const net = income - expenses;

      const out = [
        "📊 *This Month*",
        "",
        codeBlock([
          `Income    ${formatMoney(income)}`,
          `Expenses  ${formatMoney(expenses)}`,
          `Net       ${net >= 0 ? "+" : "-"}${formatMoney(Math.abs(net))}`
        ].join("\n"))
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Monthly error:", err);
      return bot.sendMessage(chatId, "Error calculating monthly totals.");
    }
  });
};

module.exports.help = {
  command: "monthly",
  category: "General",
  summary: "This month's income, expenses, and net.",
  usage: [
    "/monthly"
  ],
  examples: [
    "/monthly"
  ]
};
