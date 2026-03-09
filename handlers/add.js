// handlers/add.js
module.exports = function registerAddHandler(bot, deps) {
  const { ledgerService, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/add*",
      "Add a simple expense from `assets:bank` to `expenses:misc`.",
      "",
      "*Usage*",
      "- `/add <description> <amount>`",
      "",
      "*Arguments*",
      "- `<description>` — Expense description, optionally quoted if it contains spaces.",
      "- `<amount>` — Positive amount.",
      "",
      "*Examples*",
      "- `/add groceries 25`",
      "- `/add \"pet supplies\" 47.18`",
      "",
      "*Notes*",
      "- Posts to `expenses:misc` by default.",
      "- Uses today's date."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/add(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
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
            "Examples:",
            "`/add groceries 25`",
            "`/add \"pet supplies\" 47.18`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const description = String(parsed[1] || "")
        .trim()
        .replace(/^["']|["']$/g, "");
      const amount = Number(parsed[2]);

      if (!description) {
        return bot.sendMessage(
          chatId,
          [
            "Description is required.",
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
            "Amount must be greater than 0.",
            "",
            "Usage:",
            "`/add <description> <amount>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      ledgerService.addTransaction({
        date: new Date().toISOString().slice(0, 10),
        description,
        postings: [
          { account: "expenses:misc", amount },
          { account: "assets:bank", amount: -amount }
        ]
      });

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
      return bot.sendMessage(chatId, "Error adding expense.");
    }
  });
};

module.exports.help = {
  command: "add",
  category: "Transactions",
  summary: "Add a simple expense from assets:bank to expenses:misc.",
  usage: [
    "/add <description> <amount>"
  ],
  args: [
    { name: "<description>", description: "Expense description, optionally quoted if it contains spaces." },
    { name: "<amount>", description: "Positive amount." }
  ],
  examples: [
    "/add groceries 25",
    "/add \"pet supplies\" 47.18"
  ],
  notes: [
    "Posts to `expenses:misc` by default.",
    "Uses today's date."
  ]
};
