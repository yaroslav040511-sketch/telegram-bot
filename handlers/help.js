// handlers/help.js
const help = require("../data/help_registry");

module.exports = function registerHelpHandler(bot) {
  bot.onText(/^\/help(?:@\w+)?(?:\s+([a-zA-Z_]+))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const topic = String(match?.[1] || "").toLowerCase();

    if (!topic) {
      let out = "🤖 Help\n\n";
      out += "Use `/help <command>` or `/<command> help`\n\n";
      out += "Examples:\n";
      out += "/help add\n";
      out += "/add help\n";
      return bot.sendMessage(chatId, out, { parse_mode: "Markdown" });
    }

    const item = help[topic];
    if (!item) {
      return bot.sendMessage(chatId, `No help found for: ${topic}`);
    }

    let out = `📘 /${topic}\n\n`;
    out += `${item.description}\n\n`;
    out += `Usage:\n${item.usage}\n`;

    if (item.examples?.length) {
      out += `\nExamples:\n${item.examples.join("\n")}`;
    }

    return bot.sendMessage(chatId, out);
  });
};
