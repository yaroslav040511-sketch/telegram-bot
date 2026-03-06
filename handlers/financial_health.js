// handlers/financial_health.js
module.exports = function registerFinancialHealthHandler(bot, deps) {
  const { db, ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  function label(score) {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Good";
    if (score >= 55) return "Fair";
    if (score >= 40) return "Fragile";
    return "Critical";
  }

  bot.onText(/^\/financial_health(@\w+)?$/i, (msg) => {

    const chatId = msg.chat.id;

    try {

      const balances = ledgerService.getBalances();

      let bankBalance = 0;
      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const b of balances) {
        const amt = Number(b.balance) || 0;

        if (b.account === "assets:bank") bankBalance = amt;

        if (b.account.startsWith("assets:"))
          totalAssets += amt;

        if (b.account.startsWith("liabilities:"))
          totalLiabilities += Math.abs(amt);
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

      const recurringRows = db.prepare(`
        SELECT postings_json, frequency
        FROM recurring_transactions
      `).all();

      function monthlyMultiplier(freq) {
        switch ((freq || "").toLowerCase()) {
          case "daily": return 30;
          case "weekly": return 4.33;
          case "monthly": return 1;
          case "yearly": return 1 / 12;
          default: return 0;
        }
      }

      let recurringIncome = 0;
      let recurringBills = 0;

      for (const r of recurringRows) {
        try {

          const postings = JSON.parse(r.postings_json);

          const bankLine = postings.find(p => p.account === "assets:bank");

          if (!bankLine) continue;

          const amt = Number(bankLine.amount) || 0;

          const monthly = Math.abs(amt) * monthlyMultiplier(r.frequency);

          if (amt > 0) recurringIncome += monthly;
          if (amt < 0) recurringBills += monthly;

        } catch { }
      }

      const recurringNet = recurringIncome - recurringBills;

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

      let strengths = [];
      let drags = [];
      let focus = [];

      if (netMonthly > 0)
        strengths.push("positive monthly cashflow");
      else
        drags.push("negative monthly cashflow");

      if (recurringNet > 0)
        strengths.push("recurring income exceeds bills");
      else
        drags.push("recurring bills exceed income");

      if (weightedApr >= 20)
        drags.push("high interest debt");

      if (weightedApr >= 20)
        focus.push("pay down high APR debt");

      if (netMonthly < 0)
        focus.push("improve monthly cashflow");

      if (focus.length === 0)
        focus.push("maintain current trajectory");

      let runwayText =
        runwayMonths === Infinity
          ? "∞"
          : `${runwayMonths.toFixed(1)} months`;

      let out = "🩺 Financial Health\n\n";

      out += "```\n";
      out += `Score:            ${score}/100  ${healthLabel}\n`;
      out += `Cash on Hand:     ${money(bankBalance)}\n`;
      out += `Net Worth:        ${money(netWorth)}\n`;
      out += `Monthly Net:      ${netMonthly >= 0 ? "+" : "-"}${money(Math.abs(netMonthly))}\n`;
      out += `Recurring Net:    ${recurringNet >= 0 ? "+" : "-"}${money(Math.abs(recurringNet))}\n`;
      out += `Runway:           ${runwayText}\n`;
      out += `Debt Total:       ${money(totalDebt)}\n`;
      out += `Weighted APR:     ${weightedApr.toFixed(2)}%\n`;
      out += "```\n\n";

      if (strengths.length)
        out += `✅ Strength: ${strengths[0]}\n`;

      if (drags.length)
        out += `⚠️ Drag: ${drags[0]}\n`;

      out += `🎯 Focus: ${focus[0]}`;

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });

    } catch (err) {

      console.error("financial_health error:", err);

      return bot.sendMessage(
        chatId,
        "Error calculating financial health."
      );

    }

  });

};
