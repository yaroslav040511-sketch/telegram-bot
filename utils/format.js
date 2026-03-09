// utils/format.js
function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function line(label, value, width = 14) {
  return `${String(label).padEnd(width)} ${value}`;
}

function codeBlock(lines) {
  return "```\n" + lines.join("\n") + "\n```";
}

module.exports = {
  money,
  line,
  codeBlock
};
