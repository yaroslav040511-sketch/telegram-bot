// handlers/accounts.js
module.exports = function registerAccountsHandler(bot, deps) {
  const { ledgerService, format } = deps;
  const { formatMoney, renderTable, shortenAccount } = format;

  function renderHelp() {
    return [
      "*\\/accounts*",
      "List account balances from the ledger.",
      "",
      "*Usage*",
      "- `/accounts`",
      "- `/accounts <prefix>`",
      "",
      "*Arguments*",
      "- `<prefix>` — Optional account prefix filter such as `assets`, `liabilities`, `expenses`, or `income`.",
      "",
      "*Examples*",
      "- `/accounts`",
      "- `/accounts assets`",
      "- `/accounts liabilities`",
      "- `/accounts expenses`",
      "",
      "*Notes*",
      "- Balances come from `ledgerService.getBalances()`.",
      "- Output is shown in a Markdown code block table."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/accounts(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (/^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const prefix = raw ? raw.toLowerCase() : null;
      const balances = await Promise.resolve(ledgerService.getBalances());

      if (!balances || balances.length === 0) {
        return bot.sendMessage(chatId, "No accounts found.");
      }

      const filtered = prefix
        ? balances.filter((b) =>
          String(b.account || "").toLowerCase().startsWith(prefix)
        )
        : balances;

      if (filtered.length === 0) {
        return bot.sendMessage(
          chatId,
          [
            `No accounts found for prefix \`${prefix}\`.`,
            "",
            "Try:",
            "`/accounts`",
            "`/accounts assets`",
            "`/accounts liabilities`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const sorted = [...filtered].sort((a, b) =>
        String(a.account || "").localeCompare(String(b.account || ""))
      );

      const rows = sorted.map((b) => [
        shortenAccount(String(b.account || ""), 36),
        formatMoney(Number(b.balance) || 0)
      ]);

      const total = sorted.reduce(
        (sum, b) => sum + (Number(b.balance) || 0),
        0
      );

      const text = [
        "📒 *Account Balances*",
        "",
        renderTable(
          ["Account", "Balance"],
          rows,
          { aligns: ["left", "right"] }
        ),
        `Total: \`${formatMoney(total)}\``
      ].join("\n");

      return bot.sendMessage(chatId, text, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Accounts error:", err);
      return bot.sendMessage(chatId, "Error retrieving accounts.");
    }
  });
};

module.exports.help = {
  command: "accounts",
  category: "Reporting",
  summary: "List account balances from the ledger.",
  usage: [
    "/accounts",
    "/accounts <prefix>"
  ],
  args: [
    {
      name: "<prefix>",
      description: "Optional account prefix filter such as assets, liabilities, expenses, or income."
    }
  ],
  examples: [
    "/accounts",
    "/accounts assets",
    "/accounts liabilities",
    "/accounts expenses"
  ],
  notes: [
    "Balances come from `ledgerService.getBalances()`.",
    "Output is shown in a Markdown code block table."
  ]
};
