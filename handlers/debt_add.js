// handlers/debt_add.js
module.exports = function registerDebtAddHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/debt_add*",
      "Add or replace a debt in the debts table.",
      "",
      "*Usage*",
      "- `/debt_add <name> <balance> <apr> <minimum>`",
      "",
      "*Arguments*",
      "- `<name>` — Debt name, such as `visa`, `student_loan`, or `car_loan`.",
      "- `<balance>` — Current debt balance. Must be zero or greater.",
      "- `<apr>` — Annual percentage rate, such as `19.99`.",
      "- `<minimum>` — Minimum monthly payment. Must be zero or greater.",
      "",
      "*Examples*",
      "- `/debt_add visa 3200 24.99 95`",
      "- `/debt_add student_loan 12000 5.5 140`",
      "- `/debt_add car_loan 8700 7.25 260`",
      "",
      "*Notes*",
      "- Existing debt rows with the same name are replaced.",
      "- Name should not contain spaces in this version."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debt_add(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const parsed = raw.match(/^(\S+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);

      if (!parsed) {
        return bot.sendMessage(
          chatId,
          [
            "Missing or invalid arguments for `/debt_add`.",
            "",
            "Usage:",
            "`/debt_add <name> <balance> <apr> <minimum>`",
            "",
            "Example:",
            "`/debt_add visa 3200 24.99 95`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const name = String(parsed[1] || "").trim();
      const balance = Number(parsed[2]);
      const apr = Number(parsed[3]);
      const minimum = Number(parsed[4]);

      if (!name) {
        return bot.sendMessage(
          chatId,
          [
            "Debt name is required.",
            "",
            "Usage:",
            "`/debt_add <name> <balance> <apr> <minimum>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (!Number.isFinite(balance) || balance < 0) {
        return bot.sendMessage(
          chatId,
          [
            "Balance must be zero or greater.",
            "",
            "Usage:",
            "`/debt_add <name> <balance> <apr> <minimum>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (!Number.isFinite(apr) || apr < 0) {
        return bot.sendMessage(
          chatId,
          [
            "APR must be zero or greater.",
            "",
            "Usage:",
            "`/debt_add <name> <balance> <apr> <minimum>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (!Number.isFinite(minimum) || minimum < 0) {
        return bot.sendMessage(
          chatId,
          [
            "Minimum payment must be zero or greater.",
            "",
            "Usage:",
            "`/debt_add <name> <balance> <apr> <minimum>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      db.prepare(`
        INSERT OR REPLACE INTO debts (name, balance, apr, minimum)
        VALUES (?, ?, ?, ?)
      `).run(name, balance, apr, minimum);

      return bot.sendMessage(
        chatId,
        [
          "💳 *Debt saved*",
          "",
          codeBlock([
            `Name      ${name}`,
            `Balance   ${formatMoney(balance)}`,
            `APR       ${apr}%`,
            `Minimum   ${formatMoney(minimum)}`
          ].join("\n"))
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("debt_add error:", err);
      return bot.sendMessage(chatId, "Error adding debt.");
    }
  });
};

module.exports.help = {
  command: "debt_add",
  category: "Debt",
  summary: "Add or replace a debt in the debts table.",
  usage: [
    "/debt_add <name> <balance> <apr> <minimum>"
  ],
  args: [
    { name: "<name>", description: "Debt name, such as visa or student_loan." },
    { name: "<balance>", description: "Current balance. Must be zero or greater." },
    { name: "<apr>", description: "APR percentage, such as 19.99." },
    { name: "<minimum>", description: "Minimum monthly payment. Must be zero or greater." }
  ],
  examples: [
    "/debt_add visa 3200 24.99 95",
    "/debt_add student_loan 12000 5.5 140",
    "/debt_add car_loan 8700 7.25 260"
  ],
  notes: [
    "Existing debt rows with the same name are replaced.",
    "Name should not contain spaces in this version."
  ]
};
