'use strict';

const {
  getMissingArgsMessage,
  renderCommandHelp
} = require('./help-system');

function isHelpRequest(args) {
  if (!Array.isArray(args) || args.length === 0) return false;
  if (args.length !== 1) return false;

  const value = String(args[0] || '').trim().toLowerCase();
  return value === 'help' || value === '--help' || value === '-h';
}

async function replyMarkdown(ctx, text) {
  return ctx.reply(text, { parse_mode: 'Markdown' });
}

async function executeHandler({ commandName, args, ctx, deps }) {
  const index = deps.helpIndex;
  const handler = index.resolve(commandName);

  if (!handler) {
    return replyMarkdown(
      ctx,
      `Unknown command: \`/${commandName}\`\n\nUse \`/help\` to see all commands.`
    );
  }

  if (isHelpRequest(args)) {
    return replyMarkdown(ctx, renderCommandHelp(handler));
  }

  if (handler.minArgs > 0 && args.length < handler.minArgs) {
    return replyMarkdown(ctx, getMissingArgsMessage(handler));
  }

  return handler.run({ args, ctx, deps });
}

module.exports = {
  executeHandler
};
