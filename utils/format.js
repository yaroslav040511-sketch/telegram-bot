// utils/format.js
function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(amount, options = {}) {
  const {
    currency = "$",
    decimals = 2,
    parensForNegative = false,
    showPlus = false,
    trimZeroCents = false
  } = options;

  const value = toNumber(amount);
  const negative = value < 0;
  const abs = Math.abs(value);

  let formatted = abs.toFixed(decimals);

  if (trimZeroCents && decimals > 0) {
    formatted = formatted.replace(/\.00$/, "");
  }

  if (negative) {
    return parensForNegative
      ? `(${currency}${formatted})`
      : `-${currency}${formatted}`;
  }

  if (showPlus && value > 0) {
    return `+${currency}${formatted}`;
  }

  return `${currency}${formatted}`;
}

function repeat(char, count) {
  return new Array(Math.max(0, count) + 1).join(char);
}

function padLeft(value, width) {
  const s = String(value ?? "");
  return repeat(" ", Math.max(0, width - s.length)) + s;
}

function padRight(value, width) {
  const s = String(value ?? "");
  return s + repeat(" ", Math.max(0, width - s.length));
}

function codeBlock(text, language = "") {
  return `\`\`\`${language}\n${text}\n\`\`\``;
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\n/g, " ");
}

function renderTable(headers, rows, options = {}) {
  const {
    aligns = [],
    gutter = "  ",
    codeFence = true,
    language = ""
  } = options;

  const normalizedHeaders = headers.map(normalizeCell);
  const normalizedRows = rows.map((row) => row.map(normalizeCell));

  const widths = normalizedHeaders.map((header, colIndex) => {
    const cellWidths = normalizedRows.map((row) => (row[colIndex] || "").length);
    return Math.max(header.length, ...cellWidths, 0);
  });

  const formatRow = (row) =>
    row.map((cell, colIndex) => {
      const width = widths[colIndex];
      const align = aligns[colIndex] || "left";
      return align === "right"
        ? padLeft(cell, width)
        : padRight(cell, width);
    }).join(gutter);

  const lines = [
    formatRow(normalizedHeaders),
    formatRow(widths.map((w) => repeat("-", w)))
  ];

  for (const row of normalizedRows) {
    lines.push(formatRow(row));
  }

  const table = lines.join("\n");
  return codeFence ? codeBlock(table, language) : table;
}

function formatSignedMoney(amount, options = {}) {
  return formatMoney(amount, { ...options, showPlus: true });
}

function shortenAccount(account, max = 28) {
  const s = String(account || "");
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

module.exports = {
  formatMoney,
  formatSignedMoney,
  renderTable,
  codeBlock,
  padLeft,
  padRight,
  shortenAccount
};
