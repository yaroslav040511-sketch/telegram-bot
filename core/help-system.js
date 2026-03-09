'use strict';

function normalizeCommandName(input) {
  return String(input || '')
    .trim()
    .replace(/^\//, '')
    .toLowerCase();
}

function normalizeHandler(handlerModule) {
  const name = normalizeCommandName(
    handlerModule.command ||
    handlerModule.name
  );

  const aliases = Array.isArray(handlerModule.aliases)
    ? handlerModule.aliases.map(normalizeCommandName).filter(Boolean)
    : [];

  const help = handlerModule.help || {};

  return {
    ...handlerModule,
    command: name,
    aliases,
    help: {
      summary: help.summary || handlerModule.description || 'No description provided.',
      usage: Array.isArray(help.usage) ? help.usage : [],
      examples: Array.isArray(help.examples) ? help.examples : [],
      args: Array.isArray(help.args) ? help.args : [],
      notes: Array.isArray(help.notes) ? help.notes : [],
      category: help.category || 'General'
    },
    minArgs: Number.isInteger(handlerModule.minArgs) ? handlerModule.minArgs : 0,
    hidden: Boolean(handlerModule.hidden)
  };
}

function buildHelpIndex(handlersIterable) {
  const byCommand = new Map();
  const aliasToCommand = new Map();

  for (const raw of handlersIterable) {
    const handler = normalizeHandler(raw);
    if (!handler.command) continue;

    byCommand.set(handler.command, handler);

    for (const alias of handler.aliases) {
      aliasToCommand.set(alias, handler.command);
    }
  }

  return {
    byCommand,
    aliasToCommand,
    resolve(input) {
      const key = normalizeCommandName(input);
      if (!key) return null;
      if (byCommand.has(key)) return byCommand.get(key);

      const aliased = aliasToCommand.get(key);
      return aliased ? byCommand.get(aliased) : null;
    }
  };
}

function renderCommandHelp(handler, options = {}) {
  const prefix = options.prefix || '/';

  const lines = [];
  lines.push(`*${prefix}${handler.command}*`);
  lines.push(handler.help.summary);

  if (handler.aliases.length) {
    lines.push('');
    lines.push(`Aliases: ${handler.aliases.map(a => `${prefix}${a}`).join(', ')}`);
  }

  if (handler.help.usage.length) {
    lines.push('');
    lines.push('*Usage*');
    for (const line of handler.help.usage) {
      lines.push(`- \`${line}\``);
    }
  }

  if (handler.help.args.length) {
    lines.push('');
    lines.push('*Arguments*');
    for (const arg of handler.help.args) {
      lines.push(`- \`${arg.name}\` — ${arg.description}`);
    }
  }

  if (handler.help.examples.length) {
    lines.push('');
    lines.push('*Examples*');
    for (const example of handler.help.examples) {
      lines.push(`- \`${example}\``);
    }
  }

  if (handler.help.notes.length) {
    lines.push('');
    lines.push('*Notes*');
    for (const note of handler.help.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join('\n');
}

function renderHelpOverview(index, options = {}) {
  const prefix = options.prefix || '/';

  const visible = Array.from(index.byCommand.values())
    .filter(h => !h.hidden)
    .sort((a, b) => a.command.localeCompare(b.command));

  const categories = new Map();

  for (const handler of visible) {
    const cat = handler.help.category || 'General';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat).push(handler);
  }

  const lines = [];
  lines.push('*Available commands*');
  lines.push('Use `/help <command>` or `/<command> help` for details.');

  for (const [category, handlers] of Array.from(categories.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push('');
    lines.push(`*${category}*`);
    for (const handler of handlers) {
      lines.push(`- \`${prefix}${handler.command}\` — ${handler.help.summary}`);
    }
  }

  return lines.join('\n');
}

function getMissingArgsMessage(handler, options = {}) {
  const prefix = options.prefix || '/';
  const usage = handler.help.usage?.[0]
    ? `\n\nUsage: \`${handler.help.usage[0]}\``
    : '';
  return `Missing required arguments for \`${prefix}${handler.command}\`. Use \`/${handler.command} help\` for details.${usage}`;
}

module.exports = {
  normalizeCommandName,
  normalizeHandler,
  buildHelpIndex,
  renderCommandHelp,
  renderHelpOverview,
  getMissingArgsMessage
};
