module.exports = function registerSafetyHandler(bot, db) {

  bot.onText(/^\/safety(@\w+)?$/, (msg) => {
    try {

      // your safety logic here

      bot.sendMessage(msg.chat.id, "Safety check complete.");

    } catch (err) {
      console.error("Safety error:", err);
      bot.sendMessage(msg.chat.id, "Error running safety check.");
    }
  });

};
