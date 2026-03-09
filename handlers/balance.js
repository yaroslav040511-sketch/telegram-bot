// handlers/balance.js
module.exports = function registerBalanceHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/balance*",
      "Show the current balance of assets:bank.",
      "",
      "*Usage*",
      "- `/balance`",
      "",
      "*Examples*",
      "- `/balance`",
      "",
      "*Notes*",
      "- Reads the balance for `assets:bank` directly from the database."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/balance(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw && !/^(help|--help|-h)$/i.test(raw)) {
      return bot.sendMessage(
        chatId,
        [
          "The `/balance` command does not take arguments.",
          "",
          "Usage:",
          "`/balance`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    if (/^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const checking = db
        .prepare(`SELECT id FROM accounts WHERE name = 'assets:bank'`)
        .get();

      if (!checking) {
        return bot.sendMessage(chatId, "assets:bank account not found.");
      }

      const row = db
        .prepare(`
          SELECT IFNULL(SUM(amount), 0) AS balance
          FROM postings
          WHERE account_id = ?
        `)
        .get(checking.id);

      const balance = Number(row?.balance) || 0;

      return bot.sendMessage(
        chatId,
        [
          "💰 *Current Balance*",
          "",
          codeBlock([
            `Account  assets:bank`,
            `Balance  ${formatMoney(balance)}`
          ].join("\n"))
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("Balance error:", err);
      return bot.sendMessage(chatId, "Balance error.");
    }
  });
};

module.exports.help = {
  command: "balance",
  category: "Reporting",
  summary: "Show the current balance of assets:bank.",
  usage: [
    "/balance"
  ],
  examples: [
    "/balance"
  ],
  notes: [
    "Reads the balance for `assets:bank` directly from the database."
  ]
};
