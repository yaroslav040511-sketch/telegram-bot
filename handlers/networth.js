// handlers/buckets.js
module.exports = function registerBucketsHandler(bot, deps) {
  const { ledgerService, db } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  bot.onText(/^\/networth(@\w+)?$/i, (msg) => {
    const chatId = msg.chat.id;

    try {
      const balances = ledgerService.getBalances();

      let cash = 0;
      let savings = 0;
      let otherAssets = 0;
      let liabilitiesFromLedger = 0;

      for (const a of balances) {
        const acct = String(a.account || "");
        const bal = Number(a.balance) || 0;

        if (acct === "assets:bank") {
          cash += bal;
        } else if (acct.startsWith("assets:")) {
          savings += bal;
          otherAssets += bal;
        } else if (acct.startsWith("liabilities:")) {
          liabilitiesFromLedger += Math.abs(bal);
        }
      }

      const debtRow = db.prepare(`
        SELECT IFNULL(SUM(balance), 0) as totalDebt
        FROM debts
      `).get();

      const debtTableTotal = Number(debtRow?.totalDebt) || 0;

      // Prefer explicit debts table if present, otherwise fallback to ledger liabilities
      const debt = debtTableTotal > 0 ? debtTableTotal : liabilitiesFromLedger;

      const totalAssets = cash + otherAssets;
      const netWorth = totalAssets - debt;

      let out = "🪣 Buckets\n\n";
      out += "```\n";
      out += `Cash:        ${money(cash)}\n`;
      out += `Savings:     ${money(savings)}\n`;
      out += `Debt:        ${money(debt)}\n`;
      out += `Net Worth:   ${netWorth >= 0 ? "+" : "-"}${money(Math.abs(netWorth))}\n`;
      out += "```";

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("buckets error:", err);
      return bot.sendMessage(chatId, "Error generating buckets summary.");
    }
  });
};
