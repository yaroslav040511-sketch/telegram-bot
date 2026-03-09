// handlers/deposit.js
module.exports = function registerDepositHandler(bot, deps) {
  const { ledgerService, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/deposit*",
      "Record money entering assets:bank from income:windfall.",
      "",
      "*Usage*",
      "- `/deposit <amount>`",
      "- `/deposit <amount> <description>`",
      "",
      "*Arguments*",
      "- `<amount>` — Positive amount to deposit.",
      "- `<description>` — Optional description. Defaults to `deposit`.",
      "",
      "*Examples*",
      "- `/deposit 500`",
      "- `/deposit 5000 windfall`",
      "- `/deposit 125.75 tax refund`",
      "",
      "*Notes*",
      "- Debits assets:bank.",
      "- Credits income:windfall.",
      "- Date defaults to today."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/deposit(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
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
            "Missing or invalid arguments for `/deposit`.",
            "",
            "Usage:",
            "`/deposit <amount> [description]`",
            "",
            "Examples:",
            "`/deposit 500`",
            "`/deposit 5000 windfall`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const amount = Number(parsed[1]);
      const description = String(parsed[2] || "deposit").trim();

      if (!Number.isFinite(amount) || amount <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "Amount must be a positive number.",
            "",
            "Usage:",
            "`/deposit <amount> [description]`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      await Promise.resolve(
        ledgerService.addTransaction({
          date: new Date().toISOString().slice(0, 10),
          description,
          postings: [
            { account: "assets:bank", amount },
            { account: "income:windfall", amount: -amount }
          ]
        })
      );

      return bot.sendMessage(
        chatId,
        [
          "✅ *Deposit recorded*",
          "",
          codeBlock([
            `Description  ${description}`,
            `Amount       ${formatMoney(amount)}`,
            `Debit        assets:bank`,
            `Credit       income:windfall`
          ].join("\n"))
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("Deposit error:", err);
      return bot.sendMessage(chatId, "Deposit failed.");
    }
  });
};

module.exports.help = {
  command: "deposit",
  category: "Entry",
  summary: "Record money entering assets:bank from income:windfall.",
  usage: [
    "/deposit <amount>",
    "/deposit <amount> <description>"
  ],
  args: [
    { name: "<amount>", description: "Positive amount to deposit." },
    { name: "<description>", description: "Optional description. Defaults to `deposit`." }
  ],
  examples: [
    "/deposit 500",
    "/deposit 5000 windfall",
    "/deposit 125.75 tax refund"
  ],
  notes: [
    "Debits assets:bank.",
    "Credits income:windfall.",
    "Date defaults to today."
  ]
};
