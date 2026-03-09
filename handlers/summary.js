// handlers/summary.js
module.exports = function registerSummaryHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, renderTable } = format;

  function renderHelp() {
    return [
      "*\\/summary*",
      "30-day spending breakdown by category.",
      "",
      "*Usage*",
      "- `/summary`",
      "",
      "*Examples*",
      "- `/summary`"
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/summary(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/summary` command does not take arguments.",
          "",
          "Usage:",
          "`/summary`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const rows = db.prepare(`
        SELECT a.name as account,
               SUM(p.amount) as total
        FROM postings p
        JOIN accounts a ON p.account_id = a.id
        JOIN transactions t ON p.transaction_id = t.id
        WHERE a.name LIKE 'expenses:%'
          AND date(t.date) >= date('now','-30 day')
        GROUP BY a.name
        ORDER BY total DESC
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "📊 30-Day Spending Summary\n\nNo expenses recorded.");
      }

      let total = 0;
      const tableRows = [];

      for (const r of rows) {
        const amt = Math.abs(Number(r.total) || 0);
        total += amt;

        const name = String(r.account || "").replace("expenses:", "");
        tableRows.push([name, formatMoney(amt)]);
      }

      tableRows.push(["Total", formatMoney(total)]);

      const out = [
        "📊 *30-Day Spending Summary*",
        "",
        renderTable(
          ["Category", "Amount"],
          tableRows,
          { aligns: ["left", "right"] }
        )
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("summary error:", err);
      return bot.sendMessage(chatId, "Error generating summary.");
    }
  });
};

module.exports.help = {
  command: "summary",
  category: "General",
  summary: "30-day spending breakdown by category.",
  usage: [
    "/summary"
  ],
  examples: [
    "/summary"
  ]
};
