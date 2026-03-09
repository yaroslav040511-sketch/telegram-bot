// utils/help.js
function normalizeCommandName(input) {
  return String(input || "")
    .trim()
    .replace(/^\//, "")
    .toLowerCase();
}

function createCommandHelp(definition) {
  const help = {
    command: normalizeCommandName(definition.command),
    summary: definition.summary || "No description provided.",
    usage: Array.isArray(definition.usage) ? definition.usage : [],
    examples: Array.isArray(definition.examples) ? definition.examples : [],
    notes: Array.isArray(definition.notes) ? definition.notes : [],
    args: Array.isArray(definition.args) ? definition.args : [],
    category: definition.category || "General"
  };

  function render() {
    const lines = [
      `/${help.command}`,
      help.summary
    ];

    if (help.usage.length) {
      lines.push("");
      lines.push("Usage:");
      for (const line of help.usage) {
        lines.push(`  ${line}`);
      }
    }

    if (help.args.length) {
      lines.push("");
      lines.push("Arguments:");
      for (const arg of help.args) {
        lines.push(`  ${arg.name} - ${arg.description}`);
      }
    }

    if (help.examples.length) {
      lines.push("");
      lines.push("Examples:");
      for (const line of help.examples) {
        lines.push(`  ${line}`);
      }
    }

    if (help.notes.length) {
      lines.push("");
      lines.push("Notes:");
      for (const line of help.notes) {
        lines.push(`  - ${line}`);
      }
    }

    return lines.join("\n");
  }

  function renderMissingArgs(message) {
    const lines = [
      message || `Missing required arguments for /${help.command}.`
    ];

    if (help.usage.length) {
      lines.push("");
      lines.push("Usage:");
      lines.push(`  ${help.usage[0]}`);
    }

    lines.push("");
    lines.push(`See /${help.command} help`);

    return lines.join("\n");
  }

  return {
    ...help,
    render,
    renderMissingArgs
  };
}

function isHelpArgument(raw) {
  const s = String(raw || "").trim().toLowerCase();
  return s === "help" || s === "--help" || s === "-h";
}

module.exports = {
  normalizeCommandName,
  createCommandHelp,
  isHelpArgument
};
