i// handlers/financial_health.js
module.exports = function registerFinancialHealthHandler(bot, deps) {
  const { db, ledgerService, format, finance } = deps;
  const { formatMoney, codeBlock } = format;
  const { getRecurringMonthlyNet } = finance;

  function label(score) {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Good";
    if (score >= 55) return "Fair";
    if (score >= 40) return "Fragile";
    return "Critical";
  }

  function renderHelp() {
    return [
      "*\\/financial_health*",
      "Show a financial scorecard based on cash, net worth, monthly cashflow, recurring cashflow, runway, debt, and weighted APR.",
      "",
      "*Usage*",
      "- `/financial_health`",
      "",
      "*Examples*",
      "- `/financial_health`",
      "",
      "*Notes*",
      "- Score ranges from 0 to 100.",
      "- Uses current month posted income and expenses plus recurring cashflow."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), { parse_mode: "Markdown" });
  }

  bot.onText(/^\/financial_health(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/financial_health` command does not take arguments.",
          "",
          "Usage:",
          "`/financial_health`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const balances = ledgerService.getBalances();

      let bankBalance = 0;
      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const b of balances) {
        const amt = Number(b.balance) || 0;

        if (b.account === "assets:bank") bankBalance = amt;
        if (String(b.account).startsWith("assets:")) totalAssets += amt;
        if (String(b.account).startsWith("liabilities:")) {
          totalLiabilities += Math.abs(amt);
        }
      }

      const netWorth = totalAssets - totalLiabilities;

      const rows = db.prepare(`
        SELECT
          a.type as type,
          SUM(p.amount) as total
        FROM transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
          AND (a.type = 'INCOME' OR a.type = 'EXPENSES')
        GROUP BY a.type
      `).all();

      let income = 0;
      let expenses = 0;

      for (const r of rows) {
        const v = Math.abs(Number(r.total) || 0);
        if (r.type === "INCOME") income = v;
        if (r.type === "EXPENSES") expenses = v;
      }

      const netMonthly = income - expenses;

      const recurring = getRecurringMonthlyNet(db);
      const recurringNet = recurring.net;

      const debts = db.prepare(`
        SELECT balance, apr
        FROM debts
      `).all();

      let totalDebt = 0;
      let weightedApr = 0;

      for (const d of debts) {
        const bal = Number(d.balance) || 0;
        const apr = Number(d.apr) || 0;

        totalDebt += bal;
        weightedApr += bal * apr;
      }

      if (totalDebt > 0) weightedApr /= totalDebt;

      let runwayMonths = Infinity;
      if (netMonthly < 0) {
        const burn = Math.abs(netMonthly);
        runwayMonths = burn > 0 ? bankBalance / burn : Infinity;
      }

      let score = 50;

      if (netMonthly > 0) score += 15;
      else score -= 15;

      if (recurringNet > 0) score += 10;
      else score -= 10;

      if (runwayMonths === Infinity) score += 15;
      else if (runwayMonths >= 12) score += 15;
      else if (runwayMonths >= 6) score += 8;
      else if (runwayMonths < 3) score -= 10;

      if (totalDebt === 0) score += 10;
      else if (totalDebt > totalAssets) score -= 10;

      if (weightedApr >= 20) score -= 8;

      if (score < 0) score = 0;
      if (score > 100) score = 100;

      const healthLabel = label(score);

      const strengths = [];
      const drags = [];
      const focus = [];

      if (netMonthly > 0) strengths.push("positive monthly cashflow");
      else drags.push("negative monthly cashflow");

      if (recurringNet > 0) strengths.push("recurring income exceeds bills");
      else drags.push("recurring bills exceed income");

      if (weightedApr >= 20) drags.push("high interest debt");
      if (weightedApr >= 20) focus.push("pay down high APR debt");
      if (netMonthly < 0) focus.push("improve monthly cashflow");
      if (focus.length === 0) focus.push("maintain current trajectory");

      const runwayText =
        runwayMonths === Infinity ? "∞" : `${runwayMonths.toFixed(1)} months`;

      const out = [
        "🩺 *Financial Health*",
        "",
        codeBlock([
          `Score            ${score}/100  ${healthLabel}`,
          `Cash on Hand     ${formatMoney(bankBalance)}`,
          `Net Worth        ${formatMoney(netWorth)}`,
          `Monthly Net      ${netMonthly >= 0 ? "+" : "-"}${formatMoney(Math.abs(netMonthly))}`,
          `Recurring Net    ${recurringNet >= 0 ? "+" : "-"}${formatMoney(Math.abs(recurringNet))}`,
          `Runway           ${runwayText}`,
          `Debt Total       ${formatMoney(totalDebt)}`,
          `Weighted APR     ${weightedApr.toFixed(2)}%`
        ].join("\n")),
        strengths.length ? `✅ Strength: ${strengths[0]}` : null,
        drags.length ? `⚠️ Drag: ${drags[0]}` : null,
        `🎯 Focus: ${focus[0]}`
      ].filter(Boolean).join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("financial_health error:", err);
      return bot.sendMessage(chatId, "Error calculating financial health.");
    }
  });
};

module.exports.help = {
  command: "financial_health",
  category: "Reporting",
  summary: "Show a financial scorecard.",
  usage: [
    "/financial_health"
  ],
  examples: [
    "/financial_health"
  ],
  notes: [
    "Score ranges from 0 to 100.",
    "Uses current month posted income and expenses plus recurring cashflow."
  ]
};
