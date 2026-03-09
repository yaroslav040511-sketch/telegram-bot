// handlers/withdraw.js
module.exports = function registerWithdrawHandler(bot, deps) {
  const { ledgerService, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/withdraw*",
      "Record money leaving assets:bank to expenses:misc.",
      "",
      "*Usage*",
      "- `/withdraw <amount>`",
      "- `/withdraw <amount> <description>`",
      "",
      "*Arguments*",
      "- `<amount>` — Positive amount to withdraw.",
      "- `<description>` — Optional description. Defaults to `withdraw`.",
      "",
      "*Examples*",
      "- `/withdraw 50`",
      "- `/withdraw 50 groceries`",
      "- `/withdraw 18.25 snacks`",
      "",
      "*Notes*",
      "- Debits expenses:misc.",
      "- Credits assets:bank.",
      "- Date defaults to today."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/withdraw(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const parsed = raw.match(/^(-?\d+(?:\.\d+)?)(?:\s+(.+))?$/);

      if (!parsed) {
        return bot.sendMessage(
          chatId,
          [
            "Missing or invalid arguments for `/withdraw`.",
            "",
            "Usage:",
            "`/withdraw <amount> [description]`",
            "",
            "Examples:",
            "`/withdraw 50`",
            "`/withdraw 50 groceries`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const amount = Number(parsed[1]);
      const description = String(parsed[2] || "withdraw").trim();

      if (!Number.isFinite(amount) || amount <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "Amount must be a positive number.",
            "",
            "Usage:",
            "`/withdraw <amount> [description]`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      await Promise.resolve(
        ledgerService.addTransaction({
          date: new Date().toISOString().slice(0, 10),
          description,
          postings: [
            { account: "expenses:misc", amount },
            { account: "assets:bank", amount: -amount }
          ]
        })
      );

      return bot.sendMessage(
        chatId,
        [
          "✅ *Withdrawal recorded*",
          "",
          codeBlock([
            `Description  ${description}`,
            `Amount       ${formatMoney(amount)}`,
            `Debit        expenses:misc`,
            `Credit       assets:bank`
          ].join("\n"))
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("Withdraw error:", err);
      return bot.sendMessage(chatId, "Withdraw failed.");
    }
  });
};

module.exports.help = {
  command: "withdraw",
  category: "Entry",
  summary: "Record money leaving assets:bank to expenses:misc.",
  usage: [
    "/withdraw <amount>",
    "/withdraw <amount> <description>"
  ],
  args: [
    { name: "<amount>", description: "Positive amount to withdraw." },
    { name: "<description>", description: "Optional description. Defaults to `withdraw`." }
  ],
  examples: [
    "/withdraw 50",
    "/withdraw 50 groceries",
    "/withdraw 18.25 snacks"
  ],
  notes: [
    "Debits expenses:misc.",
    "Credits assets:bank.",
    "Date defaults to today."
  ]
};
