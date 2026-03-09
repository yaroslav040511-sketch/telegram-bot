// handlers/endmonth.js
module.exports = function registerEndMonthHandler(bot, deps) {
  const { db, simulateCashflow, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/endmonth*",
      "Project balance after the next 30 days of recurring income and bills.",
      "",
      "*Usage*",
      "- `/endmonth`",
      "",
      "*Examples*",
      "- `/endmonth`"
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/endmonth(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/endmonth` command does not take arguments.",
          "",
          "Usage:",
          "`/endmonth`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const checking = db.prepare(`
        SELECT id
        FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(chatId, "Checking account not found.");
      }

      const balanceRow = db.prepare(`
        SELECT IFNULL(SUM(amount), 0) as balance
        FROM postings
        WHERE account_id = ?
      `).get(checking.id);

      const currentBalance = Number(balanceRow?.balance) || 0;
      const result = simulateCashflow(db, currentBalance, checking.id, 30);

      let recurringIncome = 0;
      let recurringBills = 0;

      for (const event of result.timeline || []) {
        const amt = Number(event.amount) || 0;
        if (amt > 0) recurringIncome += amt;
        if (amt < 0) recurringBills += Math.abs(amt);
      }

      const endingBalance =
        Array.isArray(result.timeline) && result.timeline.length > 0
          ? Number(result.timeline[result.timeline.length - 1].balance) || currentBalance
          : currentBalance;

      const out = [
        "📅 *End of Month*",
        "",
        codeBlock([
          `Current Balance   ${formatMoney(currentBalance)}`,
          `Recurring Income  ${formatMoney(recurringIncome)}`,
          `Recurring Bills   ${formatMoney(recurringBills)}`,
          `Ending Balance    ${formatMoney(endingBalance)}`,
          `Lowest Balance    ${formatMoney(result.lowestBalance)}`
        ].join("\n"))
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("endmonth error:", err);
      return bot.sendMessage(chatId, "Error generating end-of-month summary.");
    }
  });
};

module.exports.help = {
  command: "endmonth",
  category: "General",
  summary: "Project balance after the next 30 days of recurring income and bills.",
  usage: [
    "/endmonth"
  ],
  examples: [
    "/endmonth"
  ]
};
