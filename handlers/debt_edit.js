// handlers/debt_edit.js
module.exports = function registerDebtEditHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/debt_edit*",
      "Edit one field on an existing debt.",
      "",
      "*Usage*",
      "- `/debt_edit <name> <balance|apr|minimum> <value>`",
      "",
      "*Arguments*",
      "- `<name>` — Debt name, such as `visa` or `student_loan`.",
      "- `<balance|apr|minimum>` — Field to update.",
      "- `<value>` — New numeric value. Must be zero or greater.",
      "",
      "*Examples*",
      "- `/debt_edit chase balance 5200`",
      "- `/debt_edit chase apr 19.9`",
      "- `/debt_edit chase minimum 110`",
      "",
      "*Notes*",
      "- Debt names should not contain spaces in this version.",
      "- Matching is case-insensitive."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debt_edit(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const parsed = raw.match(/^(\S+)\s+(balance|apr|minimum)\s+(-?\d+(?:\.\d+)?)$/i);

      if (!parsed) {
        return bot.sendMessage(
          chatId,
          [
            "Missing or invalid arguments for `/debt_edit`.",
            "",
            "Usage:",
            "`/debt_edit <name> <balance|apr|minimum> <value>`",
            "",
            "Examples:",
            "`/debt_edit chase balance 5200`",
            "`/debt_edit chase apr 19.9`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const name = String(parsed[1] || "").trim();
      const field = String(parsed[2] || "").toLowerCase();
      const value = Number(parsed[3]);

      if (!name) {
        return bot.sendMessage(
          chatId,
          [
            "Debt name is required.",
            "",
            "Usage:",
            "`/debt_edit <name> <balance|apr|minimum> <value>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (!Number.isFinite(value) || value < 0) {
        return bot.sendMessage(
          chatId,
          [
            "Value must be zero or greater.",
            "",
            "Usage:",
            "`/debt_edit <name> <balance|apr|minimum> <value>`"
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

      let column = null;
      if (field === "balance") column = "balance";
      if (field === "apr") column = "apr";
      if (field === "minimum") column = "minimum";

      if (!column) {
        return bot.sendMessage(
          chatId,
          [
            "Field must be one of: `balance`, `apr`, `minimum`.",
            "",
            "Usage:",
            "`/debt_edit <name> <balance|apr|minimum> <value>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      db.prepare(`
        UPDATE debts
        SET ${column} = ?
        WHERE id = ?
      `).run(value, debt.id);

      let beforeText = "";
      let afterText = "";

      if (field === "balance") {
        beforeText = formatMoney(Number(debt.balance) || 0);
        afterText = formatMoney(value);
      }

      if (field === "apr") {
        beforeText = `${Number(debt.apr) || 0}%`;
        afterText = `${value}%`;
      }

      if (field === "minimum") {
        beforeText = formatMoney(Number(debt.minimum) || 0);
        afterText = formatMoney(value);
      }

      return bot.sendMessage(
        chatId,
        [
          "💳 *Debt updated*",
          "",
          codeBlock([
            `Name    ${debt.name}`,
            `Field   ${field}`,
            `Old     ${beforeText}`,
            `New     ${afterText}`
          ].join("\n"))
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("debt_edit error:", err);
      return bot.sendMessage(chatId, "Error editing debt.");
    }
  });
};

module.exports.help = {
  command: "debt_edit",
  category: "Debt",
  summary: "Edit one field on an existing debt.",
  usage: [
    "/debt_edit <name> <balance|apr|minimum> <value>"
  ],
  args: [
    { name: "<name>", description: "Debt name, such as visa or student_loan." },
    { name: "<balance|apr|minimum>", description: "Field to update." },
    { name: "<value>", description: "New numeric value. Must be zero or greater." }
  ],
  examples: [
    "/debt_edit chase balance 5200",
    "/debt_edit chase apr 19.9",
    "/debt_edit chase minimum 110"
  ],
  notes: [
    "Debt names should not contain spaces in this version.",
    "Matching is case-insensitive."
  ]
};
