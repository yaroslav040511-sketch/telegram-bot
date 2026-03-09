// handlers/budget.js
module.exports = function registerBudgetHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, renderTable, codeBlock } = format;

  function normalizeCategory(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return "";
    return s.startsWith("expenses:") ? s : `expenses:${s}`;
  }

  function isHelpArg(raw) {
    return /^(help|--help|-h)$/i.test(String(raw || "").trim());
  }

  function sendMarkdown(chatId, text) {
    return bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  function renderBudgetHelp() {
    return [
      "*\\/budget*",
      "Show budget versus actual spending for expense categories over the last 30 days.",
      "",
      "*Usage*",
      "- `/budget`",
      "",
      "*Examples*",
      "- `/budget`",
      "",
      "*Notes*",
      "- Spending is based on the last 30 days.",
      "- Categories come from both saved budgets and expense postings.",
      "- Related commands: `/budget_set`, `/budget_list`, `/budget_delete`."
    ].join("\n");
  }

  function renderBudgetSetHelp() {
    return [
      "*\\/budget_set*",
      "Create or update a budget amount for an expense category.",
      "",
      "*Usage*",
      "- `/budget_set <category> <amount>`",
      "",
      "*Arguments*",
      "- `<category>` — Expense category, with or without the `expenses:` prefix.",
      "- `<amount>` — Budget amount. Must be zero or greater.",
      "",
      "*Examples*",
      "- `/budget_set food 1200`",
      "- `/budget_set expenses:rent 1800`",
      "- `/budget_set dining_out 250`",
      "",
      "*Notes*",
      "- Categories are normalized to `expenses:<category>`."
    ].join("\n");
  }

  function renderBudgetListHelp() {
    return [
      "*\\/budget_list*",
      "List all saved budget categories and amounts.",
      "",
      "*Usage*",
      "- `/budget_list`",
      "",
      "*Examples*",
      "- `/budget_list`"
    ].join("\n");
  }

  function renderBudgetDeleteHelp() {
    return [
      "*\\/budget_delete*",
      "Delete a saved budget category.",
      "",
      "*Usage*",
      "- `/budget_delete <category>`",
      "",
      "*Arguments*",
      "- `<category>` — Expense category, with or without the `expenses:` prefix.",
      "",
      "*Examples*",
      "- `/budget_delete food`",
      "- `/budget_delete expenses:rent`"
    ].join("\n");
  }

  function getBudgetRows() {
    return db.prepare(`
      SELECT category, amount
      FROM budgets
      ORDER BY category
    `).all();
  }

  function getSpendRows() {
    return db.prepare(`
      SELECT a.name as account,
             ABS(IFNULL(SUM(p.amount), 0)) as spent
      FROM accounts a
      LEFT JOIN postings p ON p.account_id = a.id
      LEFT JOIN transactions t ON p.transaction_id = t.id
      WHERE a.name LIKE 'expenses:%'
        AND (
          t.date IS NULL OR
          date(t.date) >= date('now','-30 day')
        )
      GROUP BY a.name
      ORDER BY a.name
    `).all();
  }

  // /budget
  bot.onText(/^\/budget(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (isHelpArg(raw)) {
        return sendMarkdown(chatId, renderBudgetHelp());
      }

      return sendMarkdown(
        chatId,
        [
          "The `/budget` command does not take arguments.",
          "",
          "Usage:",
          "`/budget`"
        ].join("\n")
      );
    }

    try {
      const budgetRows = getBudgetRows();
      const spendRows = getSpendRows();

      const budgetMap = new Map();
      for (const row of budgetRows) {
        budgetMap.set(String(row.category), Number(row.amount) || 0);
      }

      const spentMap = new Map();
      for (const row of spendRows) {
        spentMap.set(String(row.account), Number(row.spent) || 0);
      }

      const allCategories = new Set();
      for (const row of spendRows) allCategories.add(String(row.account));
      for (const category of budgetMap.keys()) allCategories.add(category);

      if (allCategories.size === 0) {
        return bot.sendMessage(
          chatId,
          [
            "📒 Budget",
            "",
            "No expense categories or budgets found.",
            "",
            "Use `/budget_set <category> <amount>` to create one."
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const categories = Array.from(allCategories).sort();

      let totalBudget = 0;
      let totalSpent = 0;

      const rows = categories.map((account) => {
        const budget = Number(budgetMap.get(account) || 0);
        const spent = Number(spentMap.get(account) || 0);
        const left = budget - spent;
        const label = account.replace(/^expenses:/, "");

        totalBudget += budget;
        totalSpent += spent;

        return [
          label,
          formatMoney(budget),
          formatMoney(spent),
          formatMoney(left)
        ];
      });

      rows.push([
        "total",
        formatMoney(totalBudget),
        formatMoney(totalSpent),
        formatMoney(totalBudget - totalSpent)
      ]);

      const out = [
        "📒 *Budget vs Actual (30 Days)*",
        "",
        renderTable(
          ["Category", "Budget", "Spent", "Left"],
          rows,
          { aligns: ["left", "right", "right", "right"] }
        ),
        "Set: `/budget_set <category> <amount>`",
        "List: `/budget_list`",
        "Delete: `/budget_delete <category>`"
      ].join("\n");

      return sendMarkdown(chatId, out);
    } catch (err) {
      console.error("budget error:", err);
      return bot.sendMessage(chatId, "Error generating budget.");
    }
  });

  // /budget_set food 1200
  bot.onText(/^\/budget_set(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || isHelpArg(raw)) {
      return sendMarkdown(chatId, renderBudgetSetHelp());
    }

    try {
      const parsed = raw.match(/^([a-zA-Z:_-]+)\s+(-?\d+(?:\.\d+)?)$/);

      if (!parsed) {
        return sendMarkdown(
          chatId,
          [
            "Missing or invalid arguments for `/budget_set`.",
            "",
            "Usage:",
            "`/budget_set <category> <amount>`",
            "",
            "Example:",
            "`/budget_set food 1200`"
          ].join("\n")
        );
      }

      const category = normalizeCategory(parsed[1]);
      const amount = Number(parsed[2]);

      if (!category) {
        return sendMarkdown(
          chatId,
          [
            "Category is required for `/budget_set`.",
            "",
            "Usage:",
            "`/budget_set <category> <amount>`"
          ].join("\n")
        );
      }

      if (!Number.isFinite(amount) || amount < 0) {
        return sendMarkdown(
          chatId,
          [
            "Amount must be zero or greater.",
            "",
            "Usage:",
            "`/budget_set <category> <amount>`",
            "",
            "Example:",
            "`/budget_set food 1200`"
          ].join("\n")
        );
      }

      db.prepare(`
        INSERT INTO budgets (category, amount)
        VALUES (?, ?)
        ON CONFLICT(category) DO UPDATE SET amount = excluded.amount
      `).run(category, amount);

      return sendMarkdown(
        chatId,
        [
          "✅ *Budget set*",
          "",
          codeBlock([
            `Category  ${category}`,
            `Amount    ${formatMoney(amount)}`
          ].join("\n"))
        ].join("\n")
      );
    } catch (err) {
      console.error("budget_set error:", err);
      return bot.sendMessage(chatId, "Error saving budget.");
    }
  });

  // /budget_list
  bot.onText(/^\/budget_list(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (isHelpArg(raw)) {
        return sendMarkdown(chatId, renderBudgetListHelp());
      }

      return sendMarkdown(
        chatId,
        [
          "The `/budget_list` command does not take arguments.",
          "",
          "Usage:",
          "`/budget_list`"
        ].join("\n")
      );
    }

    try {
      const rows = getBudgetRows();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No budgets saved.");
      }

      const tableRows = rows.map((row) => [
        String(row.category).replace(/^expenses:/, ""),
        formatMoney(row.amount)
      ]);

      const out = [
        "📒 *Saved Budgets*",
        "",
        renderTable(
          ["Category", "Amount"],
          tableRows,
          { aligns: ["left", "right"] }
        )
      ].join("\n");

      return sendMarkdown(chatId, out);
    } catch (err) {
      console.error("budget_list error:", err);
      return bot.sendMessage(chatId, "Error listing budgets.");
    }
  });

  // /budget_delete food
  bot.onText(/^\/budget_delete(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || isHelpArg(raw)) {
      return sendMarkdown(chatId, renderBudgetDeleteHelp());
    }

    try {
      const parsed = raw.match(/^([a-zA-Z:_-]+)$/);

      if (!parsed) {
        return sendMarkdown(
          chatId,
          [
            "Missing or invalid arguments for `/budget_delete`.",
            "",
            "Usage:",
            "`/budget_delete <category>`",
            "",
            "Example:",
            "`/budget_delete food`"
          ].join("\n")
        );
      }

      const category = normalizeCategory(parsed[1]);

      const row = db.prepare(`
        SELECT category, amount
        FROM budgets
        WHERE category = ?
      `).get(category);

      if (!row) {
        return sendMarkdown(
          chatId,
          `Budget not found: \`${category}\``
        );
      }

      db.prepare(`
        DELETE FROM budgets
        WHERE category = ?
      `).run(category);

      return sendMarkdown(
        chatId,
        [
          "🗑️ *Budget deleted*",
          "",
          codeBlock([
            `Category  ${category}`,
            `Amount    ${formatMoney(row.amount)}`
          ].join("\n"))
        ].join("\n")
      );
    } catch (err) {
      console.error("budget_delete error:", err);
      return bot.sendMessage(chatId, "Error deleting budget.");
    }
  });
};

module.exports.help = {
  command: "budget",
  category: "Reporting",
  summary: "Show budget versus actual spending for expense categories over the last 30 days.",
  usage: [
    "/budget"
  ],
  examples: [
    "/budget"
  ],
  notes: [
    "Related commands: `/budget_set`, `/budget_list`, `/budget_delete`."
  ]
};
