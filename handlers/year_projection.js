// handlers/year_projection.js
module.exports = function registerYearProjectionHandler(bot, deps) {
  const { ledgerService, format, finance } = deps;
  const { formatMoney, codeBlock } = format;
  const { getRecurringMonthlyNet } = finance;

  function renderHelp() {
    return [
      "*\\/year_projection*",
      "12-month projection using recurring cashflow.",
      "",
      "*Usage*",
      "- `/year_projection`",
      "",
      "*Examples*",
      "- `/year_projection`"
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/year_projection(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/year_projection` command does not take arguments.",
          "",
          "Usage:",
          "`/year_projection`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const balances = ledgerService.getBalances();
      const bank = balances.find((b) => b.account === "assets:bank");
      const currentBalance = Number(bank?.balance) || 0;

      const recurring = getRecurringMonthlyNet(deps.db);
      const recurringIncomeMonthly = recurring.income;
      const recurringBillsMonthly = recurring.bills;
      const netMonthly = recurring.net;
      const projected12Months = currentBalance + netMonthly * 12;

      const out = [
        "📈 *12-Month Projection*",
        "",
        codeBlock([
          `Current Balance    ${formatMoney(currentBalance)}`,
          `Recurring Income   ${formatMoney(recurringIncomeMonthly)} / month`,
          `Recurring Bills    ${formatMoney(recurringBillsMonthly)} / month`,
          `Net Monthly        ${netMonthly >= 0 ? "+" : "-"}${formatMoney(Math.abs(netMonthly))}`,
          `Projected in 12 mo ${formatMoney(projected12Months)}`
        ].join("\n"))
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Year projection error:", err);
      return bot.sendMessage(chatId, "Error calculating year projection.");
    }
  });
};

module.exports.help = {
  command: "year_projection",
  category: "General",
  summary: "12-month projection using recurring cashflow.",
  usage: [
    "/year_projection"
  ],
  examples: [
    "/year_projection"
  ]
};
