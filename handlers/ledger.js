module.exports = function registerLedgerHandler(bot, db, ledgerService) {

  const { getLedger } = ledgerService;

  bot.onText(/^\/ledger(@\w+)?(?: (\d+))?$/, (msg, match) => {

    const chatId = msg.chat.id;

    try {

      const page = parseInt(match?.[2] || "1", 10);
      const limit = 10;
      const offset = (page - 1) * limit;

      const rows = getLedger(limit, offset);

      if (!rows.length) {
        bot.sendMessage(chatId, "No ledger entries found.");
        return;
      }

      let message = `📒 Ledger Entries (Page ${page})\n\n`;

      let currentTx = null;

      for (const row of rows) {

        if (currentTx !== row.transaction_id) {
          currentTx = row.transaction_id;
          message += `${row.date}  ${row.description}\n`;
        }

        message += `    ${row.account.padEnd(20)} ${row.amount}\n`;
      }

      if (rows.length === limit) {
        message += `\nUse /ledger ${page + 1} for next page.`;
      }

      bot.sendMessage(chatId, message);

    } catch (err) {
      console.error("Ledger error:", err);
      bot.sendMessage(chatId, "Error retrieving ledger.");
    }

  });

};
