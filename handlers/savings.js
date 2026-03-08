// handlers/savings.js

module.exports = function registerSavingsHandler(bot, deps) {
  const { ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  bot.onText(/^\/savings(@\w+)?$/i, (msg) => {
    const chatId = msg.chat.id;

    try {
      const balances = ledgerService.getBalances();

      const savingsAccounts = balances
        .filter(a =>
          a.account.startsWith("assets:") &&
          a.account !== "assets:bank"
        );

      if (savingsAccounts.length === 0) {
        return bot.sendMessage(chatId,
          "💾 Savings\n\nNo savings accounts found.\nUse /save <amount> to move money to savings."
        );
      }

      let total = 0;

      let out = "💾 Savings Accounts\n\n";
      out += "```\n";

      for (const a of savingsAccounts) {
        const bal = Number(a.balance) || 0;
        total += bal;

        out += `${a.account.padEnd(20)} ${money(bal)}\n`;
      }

      out += "--------------------------\n";
      out += `Total Savings: ${money(total)}\n`;
      out += "```";

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });

    } catch (err) {
      console.error("savings error:", err);
      return bot.sendMessage(chatId, "Error generating savings summary.");
    }
  });
};
