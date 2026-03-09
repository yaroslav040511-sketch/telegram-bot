// handlers/index.js
const fs = require("fs");
const path = require("path");

function normalizeCommandName(value) {
  return String(value || "")
    .trim()
    .replace(/^\//, "")
    .toLowerCase();
}

function inferCommandNameFromFile(file) {
  return normalizeCommandName(path.basename(file, ".js"));
}

function normalizeHelpEntry(file, handler) {
  const fallbackCommand = inferCommandNameFromFile(file);
  const meta = handler.help || {};

  const command = normalizeCommandName(meta.command || fallbackCommand);
  const aliases = Array.isArray(meta.aliases)
    ? meta.aliases.map(normalizeCommandName).filter(Boolean)
    : [];

  return {
    command,
    aliases,
    summary: meta.summary || "No description provided.",
    usage: Array.isArray(meta.usage) ? meta.usage : [`/${command}`],
    examples: Array.isArray(meta.examples) ? meta.examples : [],
    args: Array.isArray(meta.args) ? meta.args : [],
    notes: Array.isArray(meta.notes) ? meta.notes : [],
    category: meta.category || "General",
    hidden: Boolean(meta.hidden),
    file
  };
}

function buildCommandRegistry(files) {
  const commands = new Map();
  const aliases = new Map();
  const ordered = [];

  for (const file of files) {
    const handlerPath = path.join(__dirname, file);
    const handler = require(handlerPath);

    if (typeof handler !== "function") {
      console.warn(`Skipping ${file} — not a function export`);
      continue;
    }

    const entry = normalizeHelpEntry(file, handler);

    if (!entry.hidden) {
      commands.set(entry.command, entry);
      ordered.push(entry);

      for (const alias of entry.aliases) {
        aliases.set(alias, entry.command);
      }
    }
  }

  ordered.sort((a, b) => a.command.localeCompare(b.command));

  function resolve(name) {
    const normalized = normalizeCommandName(name);
    if (!normalized) return null;
    if (commands.has(normalized)) return commands.get(normalized);

    const aliased = aliases.get(normalized);
    return aliased ? commands.get(aliased) : null;
  }

  function list() {
    return [...ordered];
  }

  function renderOverview() {
    const categories = new Map();

    for (const entry of ordered) {
      const category = entry.category || "General";
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push(entry);
    }

    const lines = [
      "*Available commands*",
      "Use `/help <command>` or `/<command> help` for details."
    ];

    for (const [category, items] of [...categories.entries()].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      lines.push("");
      lines.push(`*${category}*`);

      for (const item of items) {
        lines.push(`- \`/${item.command}\` — ${item.summary}`);
      }
    }

    return lines.join("\n");
  }

  function renderCommandHelp(name) {
    const entry = resolve(name);
    if (!entry) return null;

    const lines = [
      `*\\/${entry.command}*`,
      entry.summary
    ];

    if (entry.aliases.length) {
      lines.push("");
      lines.push(`Aliases: ${entry.aliases.map((a) => `/${a}`).join(", ")}`);
    }

    if (entry.usage.length) {
      lines.push("");
      lines.push("*Usage*");
      for (const line of entry.usage) {
        lines.push(`- \`${line}\``);
      }
    }

    if (entry.args.length) {
      lines.push("");
      lines.push("*Arguments*");
      for (const arg of entry.args) {
        lines.push(`- \`${arg.name}\` — ${arg.description}`);
      }
    }

    if (entry.examples.length) {
      lines.push("");
      lines.push("*Examples*");
      for (const line of entry.examples) {
        lines.push(`- \`${line}\``);
      }
    }

    if (entry.notes.length) {
      lines.push("");
      lines.push("*Notes*");
      for (const line of entry.notes) {
        lines.push(`- ${line}`);
      }
    }

    return lines.join("\n");
  }

  return Object.freeze({
    list,
    resolve,
    renderOverview,
    renderCommandHelp
  });
}

module.exports = function registerAllHandlers(bot, deps) {
  const files = fs.readdirSync(__dirname)
    .filter((file) => file !== "index.js")
    .filter((file) => file.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b));

  const commandRegistry = buildCommandRegistry(files);
  const handlerDeps = Object.freeze({
    ...deps,
    commandRegistry
  });

  for (const file of files) {
    const handlerPath = path.join(__dirname, file);
    const handler = require(handlerPath);

    if (typeof handler === "function") {
      console.log(`Loading handler: ${file}`);
      handler(bot, handlerDeps);
    } else {
      console.warn(`Skipping ${file} — not a function export`);
    }
  }
};
