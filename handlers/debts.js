// handlers/debts.js
module.exports = function registerDebtsHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, renderTable } = format;

  function renderHelp() {
    return [
      "*\\/debts*",
      "List all recorded debts with balance, APR, and minimum payment.",
      "",
      "*Usage*",
      "- `/debts`",
      "",
      "*Examples*",
      "- `/debts`",
      "",
      "*Notes*",
      "- Debts are sorted by balance descending.",
      "- Output is shown in a Markdown code block table."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debts(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/debts` command does not take arguments.",
          "",
          "Usage:",
          "`/debts`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
        ORDER BY balance DESC
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      const tableRows = rows.map((row) => [
        String(row.name || ""),
        formatMoney(Number(row.balance) || 0),
        `${(Number(row.apr) || 0).toFixed(2)}%`,
        formatMoney(Number(row.minimum) || 0)
      ]);

      const totalDebt = rows.reduce(
        (sum, row) => sum + (Number(row.balance) || 0),
        0
      );

      const totalMinimum = rows.reduce(
        (sum, row) => sum + (Number(row.minimum) || 0),
        0
      );

      const out = [
        "💳 *Debts*",
        "",
        renderTable(
          ["Name", "Balance", "APR", "Minimum"],
          tableRows,
          { aligns: ["left", "right", "right", "right"] }
        ),
        `Total Debt: \`${formatMoney(totalDebt)}\``,
        `Total Minimums: \`${formatMoney(totalMinimum)}\``
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debts error:", err);
      return bot.sendMessage(chatId, "Error retrieving debts.");
    }
  });
};

module.exports.help = {
  command: "debts",
  category: "Debt",
  summary: "List all recorded debts with balance, APR, and minimum payment.",
  usage: [
    "/debts"
  ],
  examples: [
    "/debts"
  ],
  notes: [
    "Debts are sorted by balance descending.",
    "Output is shown in a Markdown code block table."
  ]
};
