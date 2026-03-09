// handlers/emergency_fund.js
module.exports = function registerEmergencyFundHandler(bot, deps) {
  const { db, ledgerService, format, finance } = deps;
  const { formatMoney, codeBlock } = format;
  const { futureMonthLabel, getRecurringMonthlyNet } = finance;

  function getBankBalance() {
    const balances = ledgerService.getBalances();
    const bank = balances.find((b) => b.account === "assets:bank");
    return Number(bank?.balance) || 0;
  }

  function getMonthlyExpenses() {
    const row = db.prepare(`
      SELECT IFNULL(SUM(p.amount), 0) as total
      FROM transactions t
      JOIN postings p ON p.transaction_id = t.id
      JOIN accounts a ON a.id = p.account_id
      WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
        AND a.type = 'EXPENSES'
    `).get();

    return Math.abs(Number(row?.total) || 0);
  }

  function renderHelp() {
    return [
      "*\\/emergency_fund*",
      "Emergency fund target analysis.",
      "",
      "*Usage*",
      "- `/emergency_fund`",
      "- `/emergency_fund <months>`",
      "",
      "*Arguments*",
      "- `<months>` — Optional target size in months of expenses. Defaults to `3`. Range: `1` to `24`.",
      "",
      "*Examples*",
      "- `/emergency_fund`",
      "- `/emergency_fund 6`",
      "",
      "*Notes*",
      "- Uses current month expenses to estimate the target.",
      "- Uses recurring monthly surplus to estimate time to goal."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/emergency_fund(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw && /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const monthsTarget = raw ? Number(raw) : 3;

      if (!Number.isInteger(monthsTarget) || monthsTarget < 1 || monthsTarget > 24) {
        return bot.sendMessage(
          chatId,
          [
            "Usage: `/emergency_fund [months]`",
            "Example: `/emergency_fund 6`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const cash = getBankBalance();
      const monthlyExpenses = getMonthlyExpenses();
      const recurring = getRecurringMonthlyNet(db);
      const recurringNet = recurring.net;

      if (monthlyExpenses <= 0) {
        return bot.sendMessage(
          chatId,
          "This month's expenses are zero or unavailable, so emergency fund target cannot be calculated."
        );
      }

      const target = monthlyExpenses * monthsTarget;
      const gap = target - cash;
      const fundedPct = target > 0 ? (cash / target) * 100 : 0;

      let statusText;
      if (cash >= target) {
        statusText = "✅ Target already funded.";
      } else if (recurringNet <= 0) {
        statusText = "⚠️ Target not funded, and recurring surplus is not positive.";
      } else {
        statusText = "🟡 In progress.";
      }

      let etaText = "unavailable";
      if (cash >= target) {
        etaText = "already funded";
      } else if (recurringNet > 0) {
        const monthsToGoal = Math.ceil(gap / recurringNet);
        etaText = `${monthsToGoal} month(s) (${futureMonthLabel(monthsToGoal)})`;
      }

      const out = [
        "🛟 *Emergency Fund*",
        "",
        codeBlock([
          `Cash on Hand      ${formatMoney(cash)}`,
          `Monthly Expenses  ${formatMoney(monthlyExpenses)}`,
          `Target Months     ${monthsTarget}`,
          `Target Fund       ${formatMoney(target)}`,
          `Recurring Surplus ${recurringNet >= 0 ? "+" : "-"}${formatMoney(Math.abs(recurringNet))}`,
          `Funded            ${fundedPct.toFixed(0)}%`,
          `Gap               ${gap > 0 ? formatMoney(gap) : formatMoney(0)}`,
          `ETA               ${etaText}`
        ].join("\n")),
        statusText
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("emergency_fund error:", err);
      return bot.sendMessage(chatId, "Error calculating emergency fund.");
    }
  });
};

module.exports.help = {
  command: "emergency_fund",
  category: "General",
  summary: "Emergency fund target analysis.",
  usage: [
    "/emergency_fund",
    "/emergency_fund <months>"
  ],
  args: [
    { name: "<months>", description: "Optional target size in months of expenses. Defaults to 3." }
  ],
  examples: [
    "/emergency_fund",
    "/emergency_fund 6"
  ],
  notes: [
    "Uses current month expenses to estimate the target.",
    "Uses recurring monthly surplus to estimate time to goal."
  ]
};
