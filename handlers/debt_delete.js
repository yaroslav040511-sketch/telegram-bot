// handlers/debt_delete.js
module.exports = function registerDebtDeleteHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/debt_delete*",
      "Delete a debt from the debts table.",
      "",
      "*Usage*",
      "- `/debt_delete <name>`",
      "",
      "*Arguments*",
      "- `<name>` — Debt name, such as `visa`, `student_loan`, or `car_loan`.",
      "",
      "*Examples*",
      "- `/debt_delete chase`",
      "- `/debt_delete visa`",
      "",
      "*Notes*",
      "- Matching is case-insensitive.",
      "- Debt names should not contain spaces in this version."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debt_delete(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const parsed = raw.match(/^(\S+)$/);

      if (!parsed) {
        return bot.sendMessage(
          chatId,
          [
            "Missing or invalid arguments for `/debt_delete`.",
            "",
            "Usage:",
            "`/debt_delete <name>`",
            "",
            "Example:",
            "`/debt_delete chase`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const name = String(parsed[1] || "").trim();

      if (!name) {
        return bot.sendMessage(
          chatId,
          [
            "Debt name is required.",
            "",
            "Usage:",
            "`/debt_delete <name>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const debt = db.prepare(`
        SELECT id, name, balance, apr, minimum
        FROM debts
        WHERE lower(name) = lower(?)
      `).get(name);

      if (!debt) {
        return bot.sendMessage(
          chatId,
          `Debt not found: \`${name}\``,
          { parse_mode: "Markdown" }
        );
      }

      db.prepare(`
        DELETE FROM debts
        WHERE id = ?
      `).run(debt.id);

      return bot.sendMessage(
        chatId,
        [
          "🗑️ *Debt deleted*",
          "",
          codeBlock([
            `Name      ${debt.name}`,
            `Balance   ${formatMoney(Number(debt.balance) || 0)}`,
            `APR       ${Number(debt.apr) || 0}%`,
            `Minimum   ${formatMoney(Number(debt.minimum) || 0)}`
          ].join("\n"))
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("debt_delete error:", err);
      return bot.sendMessage(chatId, "Error deleting debt.");
    }
  });
};

module.exports.help = {
  command: "debt_delete",
  category: "Debt",
  summary: "Delete a debt from the debts table.",
  usage: [
    "/debt_delete <name>"
  ],
  args: [
    { name: "<name>", description: "Debt name, such as visa or student_loan." }
  ],
  examples: [
    "/debt_delete chase",
    "/debt_delete visa"
  ],
  notes: [
    "Matching is case-insensitive.",
    "Debt names should not contain spaces in this version."
  ]
};
