// handlers/help.js
function escapeMarkdown(text) {
  return String(text || "").replace(/([_*`\[])/g, "\\$1");
}

function sendMarkdown(bot, chatId, text) {
  return bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

function registerHelpHandler(bot, deps) {
  const { commandRegistry } = deps;

  bot.onText(/^\/help(?:@\w+)?(?:\s+(.+))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw) {
      return sendMarkdown(bot, chatId, commandRegistry.renderOverview());
    }

    const helpText = commandRegistry.renderCommandHelp(raw);

    if (!helpText) {
      return sendMarkdown(
        bot,
        chatId,
        [
          `Unknown command: \`${escapeMarkdown(raw)}\``,
          "",
          "Use `/help` to see all commands."
        ].join("\n")
      );
    }

    return sendMarkdown(bot, chatId, helpText);
  });
}

registerHelpHandler.help = {
  command: "help",
  category: "General",
  summary: "Show all commands or detailed help for one command.",
  usage: [
    "/help",
    "/help <command>"
  ],
  args: [
    { name: "<command>", description: "Optional command name to inspect." }
  ],
  examples: [
    "/help",
    "/help add",
    "/help forecast",
    "/help debt_add"
  ],
  notes: [
    "Many commands also support `/<command> help`."
  ]
};

