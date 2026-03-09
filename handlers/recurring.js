// handlers/recurring.js
const crypto = require("crypto");

module.exports = function registerRecurringHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, renderTable, codeBlock } = format;

  function stripQuotes(s) {
    const t = String(s || "").trim();
    if (
      (t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'"))
    ) {
      return t.slice(1, -1).trim();
    }
    return t;
  }

  function isHelpArg(raw) {
    return /^(help|--help|-h)$/i.test(String(raw || "").trim());
  }

  function sendMarkdown(chatId, text) {
    return bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  function ymd(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function lastDayOfMonth(year, monthIndex0) {
    return new Date(year, monthIndex0 + 1, 0).getDate();
  }

  function atMidday(d) {
    const x = new Date(d);
    x.setHours(12, 0, 0, 0);
    return x;
  }

  function computeNextDueDate(frequency, monthlySpec) {
    const today = atMidday(new Date());
    const freq = String(frequency || "").toLowerCase();

    if (freq === "daily") {
      const d = atMidday(today);
      d.setDate(d.getDate() + 1);
      return d;
    }

    if (freq === "weekly") {
      const d = atMidday(today);
      d.setDate(d.getDate() + 7);
      return d;
    }

    if (freq === "yearly") {
      const d = atMidday(today);
      d.setFullYear(d.getFullYear() + 1);
      return d;
    }

    if (freq === "monthly") {
      const year = today.getFullYear();
      const month = today.getMonth();

      let targetDay;
      if (monthlySpec?.kind === "last") {
        targetDay = lastDayOfMonth(year, month);
      } else if (monthlySpec?.kind === "day") {
        targetDay = Math.min(monthlySpec.day, lastDayOfMonth(year, month));
      } else {
        targetDay = Math.min(today.getDate(), lastDayOfMonth(year, month));
      }

      const candidate = atMidday(new Date(year, month, targetDay));

      if (candidate < today) {
        const nextMonthFirst = new Date(year, month + 1, 1);
        const ny = nextMonthFirst.getFullYear();
        const nm = nextMonthFirst.getMonth();

        let nextTargetDay;
        if (monthlySpec?.kind === "last") {
          nextTargetDay = lastDayOfMonth(ny, nm);
        } else if (monthlySpec?.kind === "day") {
          nextTargetDay = Math.min(monthlySpec.day, lastDayOfMonth(ny, nm));
        } else {
          nextTargetDay = Math.min(today.getDate(), lastDayOfMonth(ny, nm));
        }

        return atMidday(new Date(ny, nm, nextTargetDay));
      }

      return candidate;
    }

    return null;
  }

  function makeHash(input) {
    return crypto.createHash("sha256").update(String(input)).digest("hex");
  }

  function insertRecurring({ description, postings, frequency, nextDue }) {
    const postings_json = JSON.stringify(postings);
    const next_due_date = ymd(nextDue);

    const hash = makeHash(
      `${description}|${postings_json}|${frequency}|${next_due_date}`
    );

    db.prepare(`
      INSERT INTO recurring_transactions (hash, description, postings_json, frequency, next_due_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(hash, description, postings_json, frequency, next_due_date);

    return { hash, next_due_date };
  }

  function parseRecurringArgs(raw) {
    const parsed = String(raw || "").trim().match(
      /^(.+?)\s+(-?\d+(?:\.\d+)?)\s+(daily|weekly|monthly|yearly)(?:\s+(last|\d{1,2}))?$/i
    );

    if (!parsed) return null;

    return {
      description: stripQuotes(parsed[1]),
      amount: Number(parsed[2]),
      frequency: String(parsed[3] || "").toLowerCase(),
      monthlyArg: parsed[4] ? String(parsed[4]) : null
    };
  }

  function resolveMonthlySpec(frequency, monthlyArg, monthlyHelpText) {
    let monthlySpec = null;

    if (frequency === "monthly") {
      if (!monthlyArg) {
        monthlySpec = null;
      } else if (String(monthlyArg).toLowerCase() === "last") {
        monthlySpec = { kind: "last" };
      } else {
        const day = Number(monthlyArg);
        if (!Number.isInteger(day) || day < 1 || day > 31) {
          return { error: monthlyHelpText };
        }
        monthlySpec = { kind: "day", day };
      }
    }

    return { monthlySpec };
  }

  function recurringHelp() {
    return [
      "*\\/recurring*",
      "Add a recurring expense paid from `assets:bank` to `expenses:recurring`.",
      "",
      "*Usage*",
      "- `/recurring <description> <amount> <daily|weekly|monthly|yearly>`",
      "- `/recurring <description> <amount> monthly <day>`",
      "- `/recurring <description> <amount> monthly last`",
      "",
      "*Arguments*",
      "- `<description>` — Description, optionally quoted if it contains spaces.",
      "- `<amount>` — Positive amount.",
      "- `<daily|weekly|monthly|yearly>` — Frequency.",
      "- `<day>` — Optional monthly day from `1` to `31`, or `last`.",
      "",
      "*Examples*",
      "- `/recurring rent 427 monthly 3`",
      "- `/recurring \"Rent\" 427 monthly last`",
      "- `/recurring spotify 11.99 monthly`",
      "",
      "*Notes*",
      "- Expense recurring items credit `assets:bank` and debit `expenses:recurring`.",
      "- If monthly day is omitted, today's day-of-month is used."
    ].join("\n");
  }

  function recurringIncomeHelp() {
    return [
      "*\\/recurring_income*",
      "Add recurring income flowing into `assets:bank` from `income:recurring`.",
      "",
      "*Usage*",
      "- `/recurring_income <description> <amount> <daily|weekly|monthly|yearly>`",
      "- `/recurring_income <description> <amount> monthly <day>`",
      "- `/recurring_income <description> <amount> monthly last`",
      "",
      "*Arguments*",
      "- `<description>` — Description, optionally quoted if it contains spaces.",
      "- `<amount>` — Positive amount.",
      "- `<daily|weekly|monthly|yearly>` — Frequency.",
      "- `<day>` — Optional monthly day from `1` to `31`, or `last`.",
      "",
      "*Examples*",
      "- `/recurring_income paycheck 2500 weekly`",
      "- `/recurring_income \"Social Security\" 1500 monthly 3`",
      "- `/recurring_income pension 1200 monthly last`",
      "",
      "*Notes*",
      "- Income recurring items debit `assets:bank` and credit `income:recurring`."
    ].join("\n");
  }

  function recurringListHelp() {
    return [
      "*\\/recurring_list*",
      "List saved recurring items.",
      "",
      "*Usage*",
      "- `/recurring_list`",
      "",
      "*Examples*",
      "- `/recurring_list`",
      "",
      "*Notes*",
      "- Shows the next due date and a short hash reference.",
      "- Use `/recurring_delete <id|hash>` to remove an item."
    ].join("\n");
  }

  function recurringDeleteHelp() {
    return [
      "*\\/recurring_delete*",
      "Delete a recurring item by numeric id or hash prefix.",
      "",
      "*Usage*",
      "- `/recurring_delete <id>`",
      "- `/recurring_delete <hashPrefix>`",
      "",
      "*Arguments*",
      "- `<id>` — Numeric recurring id from `/recurring_list`.",
      "- `<hashPrefix>` — Leading characters from the recurring hash, usually 3 to 64 hex chars.",
      "",
      "*Examples*",
      "- `/recurring_delete 3`",
      "- `/recurring_delete a1b2c3`"
    ].join("\n");
  }

  // /recurring
  bot.onText(/^\/recurring(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || isHelpArg(raw)) {
      return sendMarkdown(chatId, recurringHelp());
    }

    try {
      const parsed = parseRecurringArgs(raw);

      if (!parsed) {
        return sendMarkdown(
          chatId,
          [
            "Missing or invalid arguments for `/recurring`.",
            "",
            "Usage:",
            "`/recurring <description> <amount> <daily|weekly|monthly|yearly> [day|last]`",
            "",
            "Examples:",
            "`/recurring rent 427 monthly 3`",
            "`/recurring \"Rent\" 427 monthly last`"
          ].join("\n")
        );
      }

      const { description, amount, frequency, monthlyArg } = parsed;

      if (!description) {
        return sendMarkdown(
          chatId,
          [
            "Description is required.",
            "",
            "Usage:",
            "`/recurring <description> <amount> <daily|weekly|monthly|yearly> [day|last]`"
          ].join("\n")
        );
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        return sendMarkdown(
          chatId,
          [
            "Amount must be a positive number.",
            "",
            "Usage:",
            "`/recurring <description> <amount> <daily|weekly|monthly|yearly> [day|last]`"
          ].join("\n")
        );
      }

      const monthlyResolution = resolveMonthlySpec(
        frequency,
        monthlyArg,
        [
          "For monthly recurring expenses, use day `1-31` or `last`.",
          "",
          "Examples:",
          "`/recurring rent 427 monthly 3`",
          "`/recurring rent 427 monthly last`"
        ].join("\n")
      );

      if (monthlyResolution.error) {
        return sendMarkdown(chatId, monthlyResolution.error);
      }

      const nextDue = computeNextDueDate(frequency, monthlyResolution.monthlySpec);
      if (!nextDue) {
        return sendMarkdown(
          chatId,
          [
            "Frequency must be one of: `daily`, `weekly`, `monthly`, `yearly`.",
            "",
            "Usage:",
            "`/recurring <description> <amount> <daily|weekly|monthly|yearly> [day|last]`"
          ].join("\n")
        );
      }

      const postings = [
        { account: "assets:bank", amount: -amount },
        { account: "expenses:recurring", amount: amount }
      ];

      const { hash, next_due_date } = insertRecurring({
        description,
        postings,
        frequency,
        nextDue
      });

      const schedule =
        frequency === "monthly" && monthlyArg
          ? `${frequency} (${monthlyArg})`
          : frequency;

      return sendMarkdown(
        chatId,
        [
          "✅ *Recurring expense added*",
          "",
          codeBlock([
            `Description  ${description}`,
            `Amount       ${formatMoney(amount)}`,
            `Frequency    ${schedule}`,
            `Next Due     ${next_due_date}`,
            `Ref          ${hash.slice(0, 6)}`,
            `Debit        expenses:recurring`,
            `Credit       assets:bank`
          ].join("\n"))
        ].join("\n")
      );
    } catch (err) {
      console.error("recurring add error:", err);
      return bot.sendMessage(chatId, "Error adding recurring bill.");
    }
  });

  // /recurring_income
  bot.onText(/^\/recurring_income(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || isHelpArg(raw)) {
      return sendMarkdown(chatId, recurringIncomeHelp());
    }

    try {
      const parsed = parseRecurringArgs(raw);

      if (!parsed) {
        return sendMarkdown(
          chatId,
          [
            "Missing or invalid arguments for `/recurring_income`.",
            "",
            "Usage:",
            "`/recurring_income <description> <amount> <daily|weekly|monthly|yearly> [day|last]`",
            "",
            "Examples:",
            "`/recurring_income paycheck 2500 weekly`",
            "`/recurring_income \"Social Security\" 1500 monthly 3`"
          ].join("\n")
        );
      }

      const { description, amount, frequency, monthlyArg } = parsed;

      if (!description) {
        return sendMarkdown(
          chatId,
          [
            "Description is required.",
            "",
            "Usage:",
            "`/recurring_income <description> <amount> <daily|weekly|monthly|yearly> [day|last]`"
          ].join("\n")
        );
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        return sendMarkdown(
          chatId,
          [
            "Amount must be a positive number.",
            "",
            "Usage:",
            "`/recurring_income <description> <amount> <daily|weekly|monthly|yearly> [day|last]`"
          ].join("\n")
        );
      }

      const monthlyResolution = resolveMonthlySpec(
        frequency,
        monthlyArg,
        [
          "For monthly recurring income, use day `1-31` or `last`.",
          "",
          "Example:",
          "`/recurring_income \"Social Security\" 1500 monthly 3`"
        ].join("\n")
      );

      if (monthlyResolution.error) {
        return sendMarkdown(chatId, monthlyResolution.error);
      }

      const nextDue = computeNextDueDate(frequency, monthlyResolution.monthlySpec);
      if (!nextDue) {
        return sendMarkdown(
          chatId,
          [
            "Frequency must be one of: `daily`, `weekly`, `monthly`, `yearly`.",
            "",
            "Usage:",
            "`/recurring_income <description> <amount> <daily|weekly|monthly|yearly> [day|last]`"
          ].join("\n")
        );
      }

      const postings = [
        { account: "assets:bank", amount: amount },
        { account: "income:recurring", amount: -amount }
      ];

      const { hash, next_due_date } = insertRecurring({
        description,
        postings,
        frequency,
        nextDue
      });

      const schedule =
        frequency === "monthly" && monthlyArg
          ? `${frequency} (${monthlyArg})`
          : frequency;

      return sendMarkdown(
        chatId,
        [
          "✅ *Recurring income added*",
          "",
          codeBlock([
            `Description  ${description}`,
            `Amount       ${formatMoney(amount)}`,
            `Frequency    ${schedule}`,
            `Next Due     ${next_due_date}`,
            `Ref          ${hash.slice(0, 6)}`,
            `Debit        assets:bank`,
            `Credit       income:recurring`
          ].join("\n"))
        ].join("\n")
      );
    } catch (err) {
      console.error("recurring income add error:", err);
      return bot.sendMessage(chatId, "Error adding recurring income.");
    }
  });

  // /recurring_list
  bot.onText(/^\/recurring_list(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (isHelpArg(raw)) {
        return sendMarkdown(chatId, recurringListHelp());
      }

      return sendMarkdown(
        chatId,
        [
          "The `/recurring_list` command does not take arguments.",
          "",
          "Usage:",
          "`/recurring_list`"
        ].join("\n")
      );
    }

    try {
      const rows = db.prepare(`
        SELECT id, hash, description, postings_json, frequency, next_due_date
        FROM recurring_transactions
        ORDER BY date(next_due_date) ASC, id ASC
        LIMIT 25
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No recurring items saved.");
      }

      const tableRows = rows.map((row) => {
        let amount = 0;
        let direction = "unknown";

        try {
          const postings = JSON.parse(row.postings_json);
          const bankLine = Array.isArray(postings)
            ? postings.find((p) => p.account === "assets:bank")
            : null;

          if (bankLine) {
            const bankAmt = Number(bankLine.amount) || 0;
            amount = Math.abs(bankAmt);
            direction = bankAmt >= 0 ? "income" : "bill";
          }
        } catch (_) {
          // ignore malformed postings_json
        }

        return [
          String(row.id),
          String(row.hash).slice(0, 6),
          String(row.description || ""),
          formatMoney(amount),
          String(row.frequency || ""),
          String(row.next_due_date || ""),
          direction
        ];
      });

      const out = [
        "📌 *Recurring*",
        "",
        renderTable(
          ["ID", "Ref", "Description", "Amount", "Freq", "Next Due", "Type"],
          tableRows,
          { aligns: ["right", "left", "left", "right", "left", "left", "left"] }
        ),
        "Delete: `/recurring_delete <id|hash>`",
        "Examples: `/recurring_delete 3`, `/recurring_delete a1b2c3`"
      ].join("\n");

      return sendMarkdown(chatId, out);
    } catch (err) {
      console.error("recurring list error:", err);
      return bot.sendMessage(chatId, "Error listing recurring items.");
    }
  });

  // /recurring_delete
  bot.onText(/^\/recurring_delete(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || isHelpArg(raw)) {
      return sendMarkdown(chatId, recurringDeleteHelp());
    }

    try {
      const parsed = raw.match(/^([0-9]+|[a-f0-9]{3,64})$/i);

      if (!parsed) {
        return sendMarkdown(
          chatId,
          [
            "Missing or invalid arguments for `/recurring_delete`.",
            "",
            "Usage:",
            "`/recurring_delete <id|hashPrefix>`",
            "",
            "Examples:",
            "`/recurring_delete 3`",
            "`/recurring_delete a1b2c3`"
          ].join("\n")
        );
      }

      const token = parsed[1];
      let row = null;

      if (/^\d+$/.test(token)) {
        row = db.prepare(`
          SELECT id, hash, description, next_due_date
          FROM recurring_transactions
          WHERE id = ?
        `).get(Number(token));
      } else {
        row = db.prepare(`
          SELECT id, hash, description, next_due_date
          FROM recurring_transactions
          WHERE hash LIKE ?
          ORDER BY id DESC
          LIMIT 1
        `).get(`${token}%`);
      }

      if (!row) {
        return bot.sendMessage(chatId, "Not found.");
      }

      db.transaction(() => {
        db.prepare(`DELETE FROM recurring_events WHERE recurring_id = ?`).run(row.id);
        db.prepare(`DELETE FROM recurring_transactions WHERE id = ?`).run(row.id);
      })();

      return sendMarkdown(
        chatId,
        [
          "🗑️ *Recurring item deleted*",
          "",
          codeBlock([
            `ID          ${row.id}`,
            `Ref         ${String(row.hash).slice(0, 6)}`,
            `Description ${row.description}`,
            `Next Due    ${row.next_due_date}`
          ].join("\n"))
        ].join("\n")
      );
    } catch (err) {
      console.error("recurring delete error:", err);
      return bot.sendMessage(chatId, "Error deleting recurring item.");
    }
  });
};

module.exports.helpEntries = [
  {
    command: "recurring",
    category: "Recurring",
    summary: "Add a recurring expense paid from assets:bank to expenses:recurring.",
    usage: [
      "/recurring <description> <amount> <daily|weekly|monthly|yearly>",
      "/recurring <description> <amount> monthly <day>",
      "/recurring <description> <amount> monthly last"
    ],
    args: [
      { name: "<description>", description: "Description, optionally quoted if it contains spaces." },
      { name: "<amount>", description: "Positive amount." },
      { name: "<daily|weekly|monthly|yearly>", description: "Frequency." },
      { name: "<day>", description: "Optional monthly day from 1 to 31, or `last`." }
    ],
    examples: [
      "/recurring rent 427 monthly 3",
      "/recurring \"Rent\" 427 monthly last",
      "/recurring spotify 11.99 monthly"
    ],
    notes: [
      "Expense recurring items credit `assets:bank` and debit `expenses:recurring`."
    ]
  },
  {
    command: "recurring_income",
    category: "Recurring",
    summary: "Add recurring income flowing into assets:bank from income:recurring.",
    usage: [
      "/recurring_income <description> <amount> <daily|weekly|monthly|yearly>",
      "/recurring_income <description> <amount> monthly <day>",
      "/recurring_income <description> <amount> monthly last"
    ],
    args: [
      { name: "<description>", description: "Description, optionally quoted if it contains spaces." },
      { name: "<amount>", description: "Positive amount." },
      { name: "<daily|weekly|monthly|yearly>", description: "Frequency." },
      { name: "<day>", description: "Optional monthly day from 1 to 31, or `last`." }
    ],
    examples: [
      "/recurring_income paycheck 2500 weekly",
      "/recurring_income \"Social Security\" 1500 monthly 3",
      "/recurring_income pension 1200 monthly last"
    ],
    notes: [
      "Income recurring items debit `assets:bank` and credit `income:recurring`."
    ]
  },
  {
    command: "recurring_list",
    category: "Recurring",
    summary: "List saved recurring items.",
    usage: [
      "/recurring_list"
    ],
    examples: [
      "/recurring_list"
    ],
    notes: [
      "Shows the next due date and a short hash reference.",
      "Use `/recurring_delete <id|hash>` to remove an item."
    ]
  },
  {
    command: "recurring_delete",
    category: "Recurring",
    summary: "Delete a recurring item by numeric id or hash prefix.",
    usage: [
      "/recurring_delete <id>",
      "/recurring_delete <hashPrefix>"
    ],
    args: [
      { name: "<id>", description: "Numeric recurring id from `/recurring_list`." },
      { name: "<hashPrefix>", description: "Leading characters from the recurring hash, usually 3 to 64 hex chars." }
    ],
    examples: [
      "/recurring_delete 3",
      "/recurring_delete a1b2c3"
    ]
  }
];
