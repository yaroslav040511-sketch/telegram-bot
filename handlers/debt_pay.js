// handlers/debt_pay.js
module.exports = function registerDebtPayHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/debt_pay*",
      "Apply a payment to a debt balance.",
      "",
      "*Usage*",
      "- `/debt_pay <name> <amount>`",
      "",
      "*Arguments*",
      "- `<name>` — Debt name, such as `visa` or `student_loan`.",
      "- `<amount>` — Positive payment amount.",
      "",
      "*Examples*",
      "- `/debt_pay chase 200`",
      "- `/debt_pay visa 95.50`",
      "",
      "*Notes*",
      "- Payment is capped at the remaining balance.",
      "- Debt names should not contain spaces in this version.",
      "- Matching is case-insensitive."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debt_pay(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const parsed = raw.match(/^(\S+)\s+(-?\d+(?:\.\d+)?)$/);

      if (!parsed) {
        return bot.sendMessage(
          chatId,
          [
            "Missing or invalid arguments for `/debt_pay`.",
            "",
            "Usage:",
            "`/debt_pay <name> <amount>`",
            "",
            "Example:",
            "`/debt_pay chase 200`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const name = String(parsed[1] || "").trim();
      const payment = Number(parsed[2]);

      if (!name) {
        return bot.sendMessage(
          chatId,
          [
            "Debt name is required.",
            "",
            "Usage:",
            "`/debt_pay <name> <amount>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (!Number.isFinite(payment) || payment <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "Payment amount must be a positive number.",
            "",
            "Usage:",
            "`/debt_pay <name> <amount>`",
            "",
            "Example:",
            "`/debt_pay chase 200`"
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

      const oldBalance = Number(debt.balance) || 0;
      const applied = Math.min(payment, oldBalance);
      const newBalance = Math.max(0, oldBalance - applied);

      db.prepare(`
        UPDATE debts
        SET balance = ?
        WHERE id = ?
      `).run(newBalance, debt.id);

      const lines = [
        "💳 *Debt payment applied*",
        "",
        codeBlock([
          `Name         ${debt.name}`,
          `Old Balance  ${formatMoney(oldBalance)}`,
          `Payment      ${formatMoney(applied)}`,
          `New Balance  ${formatMoney(newBalance)}`
        ].join("\n"))
      ];

      if (payment > oldBalance) {
        lines.push("");
        lines.push(`Only \`${formatMoney(applied)}\` was needed to pay this debt off.`);
      }

      return bot.sendMessage(chatId, lines.join("\n"), {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("debt_pay error:", err);
      return bot.sendMessage(chatId, "Error applying debt payment.");
    }
  });
};

module.exports.help = {
  command: "debt_pay",
  category: "Debt",
  summary: "Apply a payment to a debt balance.",
  usage: [
    "/debt_pay <name> <amount>"
  ],
  args: [
    { name: "<name>", description: "Debt name, such as visa or student_loan." },
    { name: "<amount>", description: "Positive payment amount." }
  ],
  examples: [
    "/debt_pay chase 200",
    "/debt_pay visa 95.50"
  ],
  notes: [
    "Payment is capped at the remaining balance.",
    "Debt names should not contain spaces in this version.",
    "Matching is case-insensitive."
  ]
};
