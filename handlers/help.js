// handlers/help.js
module.exports = function registerHelpHandler(bot, deps) {
  const { commandRegistry } = deps;

  function renderFallbackOverview() {
    return [
      "*Help*",
      "Help index is not available yet.",
      "",
      "Try `/<command> help` for a specific command."
    ].join("\n");
  }

  function renderFallbackCommand(command) {
    return [
      `No help found for \`/${command}\`.`,
      "",
      "Try `/help` to see available commands."
    ].join("\n");
  }

  bot.onText(/^\/help(?:@\w+)?(?:\s+(.+))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    try {
      if (!commandRegistry) {
        const text = raw
          ? renderFallbackCommand(raw.replace(/^\//, ""))
          : renderFallbackOverview();

        return bot.sendMessage(chatId, text, {
          parse_mode: "Markdown"
        });
      }

      if (!raw) {
        return bot.sendMessage(chatId, commandRegistry.renderOverview(), {
          parse_mode: "Markdown"
        });
      }

      const command = raw.replace(/^\//, "").trim().toLowerCase();
      const text = commandRegistry.renderCommandHelp(command);

      if (!text) {
        return bot.sendMessage(
          chatId,
          renderFallbackCommand(command),
          { parse_mode: "Markdown" }
        );
      }

      return bot.sendMessage(chatId, text, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("help error:", err);
      return bot.sendMessage(chatId, "Error showing help.");
    }
  });
};

module.exports.help = {
  command: "help",
  category: "General",
  summary: "Show all commands or detailed help for one command.",
  usage: [
    "/help",
    "/help <command>"
  ],
  args: [
    { name: "<command>", description: "Optional command name, such as budget_set or recurring_delete." }
  ],
  examples: [
    "/help",
    "/help add",
    "/help budget_set",
    "/help recurring_delete"
  ],
  notes: [
    "You can also use `/<command> help` for command-specific help."
  ]
};
