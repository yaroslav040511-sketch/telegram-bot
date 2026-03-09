// handlers/burnrate.js
module.exports = function registerBurnrateHandler(bot, deps) {
  const { db, ledgerService, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/burnrate*",
      "Show monthly spending versus income and estimated runway.",
      "",
      "*Usage*",
      "- `/burnrate`",
      "",
      "*Examples*",
      "- `/burnrate`"
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), { parse_mode: "Markdown" });
  }

  bot.onText(/^\/burnrate(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/burnrate` command does not take arguments.",
          "",
          "Usage:",
          "`/burnrate`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const balances = ledgerService.getBalances();
      const bank = balances.find((b) => b.account === "assets:bank");
      const bankBalance = Number(bank?.balance) || 0;

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
      const burnMonthly = netMonthly < 0 ? Math.abs(netMonthly) : 0;
      const burnDaily = burnMonthly / 30;

      let runwayText = "∞";
      if (burnMonthly > 0) {
        const months = bankBalance / burnMonthly;
        const days = bankBalance / burnDaily;
        runwayText = `${months.toFixed(1)} months (${Math.floor(days)} days)`;
      }

      const out = [
        "🔥 *Burn Rate*",
        "",
        codeBlock([
          `Bank Balance      ${formatMoney(bankBalance)}`,
          `Monthly Income    ${formatMoney(income)}`,
          `Monthly Expenses  ${formatMoney(expenses)}`,
          `Net Monthly       ${netMonthly >= 0 ? "+" : "-"}${formatMoney(Math.abs(netMonthly))}`,
          `Burn / Month      ${formatMoney(burnMonthly)}`,
          `Burn / Day        ${formatMoney(burnDaily)}`,
          `Runway            ${runwayText}`
        ].join("\n"))
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Burnrate error:", err);
      return bot.sendMessage(chatId, "Error calculating burn rate.");
    }
  });
};

module.exports.help = {
  command: "burnrate",
  category: "General",
  summary: "Monthly spending vs income and runway.",
  usage: [
    "/burnrate"
  ],
  examples: [
    "/burnrate"
  ]
};
