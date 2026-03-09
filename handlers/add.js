// handlers/add.js
module.exports = function registerAddHandler(bot, deps) {
  const { ledgerService, format } = deps;
  const { formatMoney, codeBlock } = format;

  function usage(chatId) {
    return bot.sendMessage(chatId, registerAddHandler.helpText(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/add(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return usage(chatId);
    }

    try {
      const parsed = raw.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)$/);

      if (!parsed) {
        return bot.sendMessage(
          chatId,
          [
            "Missing or invalid arguments for `/add`.",
            "",
            "Usage:",
            "`/add <description> <amount>`",
            "",
            "Example:",
            "`/add groceries 25`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const description = String(parsed[1] || "").trim();
      const amount = Number(parsed[2]);

      if (!description) {
        return bot.sendMessage(
          chatId,
          [
            "Missing description for `/add`.",
            "",
            "Usage:",
            "`/add <description> <amount>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "Amount must be a positive number.",
            "",
            "Usage:",
            "`/add <description> <amount>`",
            "",
            "Example:",
            "`/add groceries 25`"
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
          "✅ *Expense added*",
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
      console.error("add error:", err);
      return bot.sendMessage(
        chatId,
        "Error adding expense for `/add`.",
        { parse_mode: "Markdown" }
      );
    }
  });
};

registerAddHandler.help = {
  command: "add",
  category: "Entry",
  summary: "Add a simple expense from assets:bank to expenses:misc.",
  usage: [
    "/add <description> <amount>"
  ],
  args: [
    { name: "<description>", description: "Expense description. Can contain spaces." },
    { name: "<amount>", description: "Positive amount. The last token must be the amount." }
  ],
  examples: [
    "/add groceries 25",
    "/add coffee 4.50",
    "/add taxi home 18.75"
  ],
  notes: [
    "Posts debit to expenses:misc.",
    "Posts credit to assets:bank.",
    "Date defaults to today."
  ]
};

registerAddHandler.helpText = function helpText() {
  return [
    "*\\/add*",
    "Add a simple expense from assets:bank to expenses:misc.",
    "",
    "*Usage*",
    "- `/add <description> <amount>`",
    "",
    "*Examples*",
    "- `/add groceries 25`",
    "- `/add coffee 4.50`",
    "- `/add taxi home 18.75`",
    "",
    "*Notes*",
    "- Posts debit to expenses:misc.",
    "- Posts credit to assets:bank.",
    "- Date defaults to today."
  ].join("\n");
};
