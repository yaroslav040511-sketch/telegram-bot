// handlers/whatif.js

module.exports = function registerWhatIfHandler(bot, db, simulateCashflow) {

  // Fallback if no amount
  bot.onText(/^\/whatif$/, (msg) => {
    return bot.sendMessage(msg.chat.id, "Usage: /whatif 50");
  });

  bot.onText(/^\/whatif (-?\d+(\.\d+)?)/, (msg, match) => {
    try {

      const amount = Number(match[1]);

      const checking = db.prepare(`
        SELECT id FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(msg.chat.id, "Checking account not found.");
      }

      const balanceRow = db.prepare(`
        SELECT SUM(amount) as balance
        FROM postings
        WHERE account_id = ?
      `).get(checking.id);

      const currentBalance = Number(balanceRow?.balance) || 0;

      const adjustedBalance = currentBalance - amount;

      const result = simulateCashflow(
        db,
        adjustedBalance,
        checking.id,
        30
      );

      const lowest = result?.lowestBalance ?? adjustedBalance;

      let output = `🧪 What If Scenario\n\n`;

      if (amount >= 0) {
        output += `Simulated expense: $${amount.toLocaleString()}\n`;
      } else {
        output += `Simulated income: $${Math.abs(amount).toLocaleString()}\n`;
      }

      output += `New starting balance: $${adjustedBalance.toLocaleString()}\n`;
      output += `Projected 30-Day Minimum: $${lowest.toLocaleString()}\n\n`;

      if (lowest < 0) {
        output += "⚠️ This would cause an overdraft within 30 days.";
      } else {
        output += "✅ No overdraft risk in the next 30 days.";
      }

      return bot.sendMessage(msg.chat.id, output);

    } catch (err) {
      console.error("What-if error:", err);
      bot.sendMessage(msg.chat.id, "What-if error.");
    }
  });

};
