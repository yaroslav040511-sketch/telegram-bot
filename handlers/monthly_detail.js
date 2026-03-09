// handlers/monthly_detail.js
module.exports = function registerMonthlyDetailHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, renderTable } = format;

  function renderHelp() {
    return [
      "*\\/monthly_detail*",
      "Income vs expense breakdown.",
      "",
      "*Usage*",
      "- `/monthly_detail`",
      "",
      "*Examples*",
      "- `/monthly_detail`"
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/monthly_detail(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/monthly_detail` command does not take arguments.",
          "",
          "Usage:",
          "`/monthly_detail`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const rows = db.prepare(`
        SELECT
          a.name as account,
          a.type as type,
          SUM(p.amount) as total
        FROM transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
          AND (a.type = 'INCOME' OR a.type = 'EXPENSES')
        GROUP BY a.name, a.type
        ORDER BY a.type ASC, ABS(SUM(p.amount)) DESC, a.name ASC
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No income or expense activity this month.");
      }

      const incomeRows = [];
      const expenseRows = [];
      let incomeTotal = 0;
      let expenseTotal = 0;

      for (const r of rows) {
        const amount = Math.abs(Number(r.total) || 0);

        if (r.type === "INCOME") {
          incomeRows.push([r.account, formatMoney(amount)]);
          incomeTotal += amount;
        }

        if (r.type === "EXPENSES") {
          const pct = expenseTotal > 0
            ? "0%"
            : null;
          expenseRows.push({
            account: r.account,
            amount
          });
          expenseTotal += amount;
        }
      }

      const expenseTableRows = expenseRows.map((r) => {
        const pct = expenseTotal > 0
          ? `${((r.amount / expenseTotal) * 100).toFixed(0)}%`
          : "0%";

        return [r.account, formatMoney(r.amount), pct];
      });

      const net = incomeTotal - expenseTotal;

      let out = "📊 *Monthly Detail*";

      if (incomeRows.length) {
        out += "\n\nIncome\n";
        out += renderTable(
          ["Account", "Amount"],
          incomeRows,
          { aligns: ["left", "right"] }
        );
      }

      if (expenseTableRows.length) {
        out += "\n\nExpenses\n";
        out += renderTable(
          ["Account", "Amount", "%"],
          expenseTableRows,
          { aligns: ["left", "right", "right"] }
        );
      }

      out += "\n\nTotals\n";
      out += renderTable(
        ["Type", "Amount"],
        [
          ["Income", formatMoney(incomeTotal)],
          ["Expenses", formatMoney(expenseTotal)],
          ["Net", `${net >= 0 ? "+" : "-"}${formatMoney(Math.abs(net))}`]
        ],
        { aligns: ["left", "right"] }
      );

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Monthly detail error:", err);
      return bot.sendMessage(chatId, "Error calculating monthly detail.");
    }
  });
};

module.exports.help = {
  command: "monthly_detail",
  category: "General",
  summary: "Income vs expense breakdown.",
  usage: [
    "/monthly_detail"
  ],
  examples: [
    "/monthly_detail"
  ]
};
