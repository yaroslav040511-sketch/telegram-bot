// handlers/save.js
module.exports = function registerSaveHandler(bot, deps) {
  const { ledgerService, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/save*",
      "Move money from assets:bank to assets:savings.",
      "",
      "*Usage*",
      "- `/save <amount>`",
      "",
      "*Arguments*",
      "- `<amount>` — Positive amount to move into savings.",
      "",
      "*Examples*",
      "- `/save 25`",
      "- `/save 94.59`",
      "",
      "*Notes*",
      "- Credits assets:bank.",
      "- Debits assets:savings.",
      "- Description is recorded as `Savings transfer`."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/save(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const amount = Number(raw);

      if (!Number.isFinite(amount) || amount <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "Amount must be a positive number.",
            "",
            "Usage:",
            "`/save <amount>`",
            "",
            "Example:",
            "`/save 94.59`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      await Promise.resolve(
        ledgerService.addTransaction({
          date: new Date().toISOString().slice(0, 10),
          description: "Savings transfer",
          postings: [
            { account: "assets:bank", amount: -amount },
            { account: "assets:savings", amount: amount }
          ]
        })
      );

      return bot.sendMessage(
        chatId,
        [
          "💾 *Savings transfer recorded*",
          "",
          codeBlock([
            `Amount   ${formatMoney(amount)}`,
            `From     assets:bank`,
            `To       assets:savings`
          ].join("\n"))
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("save error:", err);
      return bot.sendMessage(
        chatId,
        "Error recording savings transfer.",
        { parse_mode: "Markdown" }
      );
    }
  });
};

module.exports.help = {
  command: "save",
  category: "Entry",
  summary: "Move money from assets:bank to assets:savings.",
  usage: [
    "/save <amount>"
  ],
  args: [
    { name: "<amount>", description: "Positive amount to move into savings." }
  ],
  examples: [
    "/save 25",
    "/save 94.59"
  ],
  notes: [
    "Credits assets:bank.",
    "Debits assets:savings.",
    "Description is recorded as `Savings transfer`."
  ]
};
