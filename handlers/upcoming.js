// handlers/upcoming.js
module.exports = function registerUpcomingHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney, codeBlock } = format;

  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseYMD(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(y, mo, d, 12, 0, 0, 0);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function nextDueDate(dateObj, frequency) {
    const d = new Date(dateObj);
    d.setHours(12, 0, 0, 0);

    switch ((frequency || "").toLowerCase()) {
      case "daily":
        d.setDate(d.getDate() + 1);
        return d;
      case "weekly":
        d.setDate(d.getDate() + 7);
        return d;
      case "monthly": {
        const day = d.getDate();
        d.setMonth(d.getMonth() + 1);
        if (d.getDate() !== day) d.setDate(0);
        d.setHours(12, 0, 0, 0);
        return d;
      }
      case "yearly":
        d.setFullYear(d.getFullYear() + 1);
        d.setHours(12, 0, 0, 0);
        return d;
      default:
        return null;
    }
  }

  function extractBankAmount(postings_json) {
    try {
      const postings = JSON.parse(postings_json);
      if (!Array.isArray(postings)) return null;
      const bank = postings.find((p) => p.account === "assets:bank");
      if (!bank) return null;
      const amt = Number(bank.amount);
      return Number.isFinite(amt) ? amt : null;
    } catch {
      return null;
    }
  }

  function classifyKind(bankAmt) {
    if (bankAmt == null) return "unknown";
    return bankAmt >= 0 ? "income" : "bill";
  }

  function renderHelp() {
    return [
      "*\\/upcoming*",
      "Show upcoming recurring events.",
      "",
      "*Usage*",
      "- `/upcoming`",
      "- `/upcoming <bill|income>`",
      "- `/upcoming <days>`",
      "- `/upcoming <bill|income> <days> <limit>`",
      "",
      "*Examples*",
      "- `/upcoming`",
      "- `/upcoming bill`",
      "- `/upcoming 60`",
      "- `/upcoming bill 60 25`",
      "",
      "*Notes*",
      "- Default range is 30 days.",
      "- Default limit is 10 events."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/upcoming(?:@\w+)?(?:\s+(.+))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = (match?.[1] || "").trim();

    if (/^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const tokens = raw ? raw.split(/\s+/) : [];

      let filter = "all";
      let days = 30;
      let limit = 10;

      for (const t of tokens) {
        const lower = t.toLowerCase();
        if (lower === "bill" || lower === "bills") filter = "bill";
        else if (lower === "income") filter = "income";
        else if (/^\d+$/.test(lower)) {
          const n = Number(lower);
          if (Number.isFinite(n)) {
            if (days === 30) days = n;
            else limit = n;
          }
        }
      }

      if (!Number.isFinite(days) || days < 1 || days > 365) {
        return bot.sendMessage(
          chatId,
          [
            "Usage: `/upcoming [bill|income] [days<=365] [limit<=50]`",
            "Example: `/upcoming bill 60 25`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
        return bot.sendMessage(
          chatId,
          [
            "Usage: `/upcoming [bill|income] [days<=365] [limit<=50]`",
            "Example: `/upcoming bill 60 25`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const today = new Date();
      today.setHours(12, 0, 0, 0);

      const end = new Date(today);
      end.setDate(end.getDate() + days);
      end.setHours(12, 0, 0, 0);

      const recurring = db.prepare(`
        SELECT id, hash, description, postings_json, frequency, next_due_date
        FROM recurring_transactions
        ORDER BY date(next_due_date) ASC, id ASC
      `).all();

      const events = [];

      for (const r of recurring) {
        const first = parseYMD(r.next_due_date);
        if (!first) continue;

        let due = new Date(first);
        due.setHours(12, 0, 0, 0);

        const bankAmt = extractBankAmount(r.postings_json);
        const kind = classifyKind(bankAmt);
        const displayAmt = bankAmt == null ? null : Math.abs(bankAmt);

        if (filter !== "all" && kind !== filter) continue;

        let guard = 0;

        while (due <= end && guard < 500) {
          if (due >= today) {
            events.push({
              date: ymd(due),
              description: r.description,
              frequency: r.frequency,
              id: r.id,
              hash: r.hash,
              kind,
              amount: displayAmt
            });
          }

          const next = nextDueDate(due, r.frequency);
          if (!next) break;
          due = next;
          due.setHours(12, 0, 0, 0);
          guard += 1;
        }
      }

      events.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

      if (!events.length) {
        const which =
          filter === "all"
            ? "recurring items"
            : filter === "bill"
              ? "bills"
              : "income items";

        return bot.sendMessage(chatId, `No upcoming ${which} in the next ${days} day(s).`);
      }

      const shown = events.slice(0, limit);
      const headerKind =
        filter === "all" ? "recurring" : filter === "bill" ? "bills" : "income";

      const lines = shown.map((e) => {
        const ref = String(e.hash || "").slice(0, 6);
        const amtText = e.amount == null ? "" : formatMoney(e.amount);
        return `${e.date}  ${e.description}  ${amtText}  (${e.frequency})  #${e.id} ${ref}`;
      });

      const out = [
        `📌 *Upcoming ${headerKind} (next ${shown.length} of ${events.length})*`,
        "",
        codeBlock(lines.join("\n")),
        "Tip: `/upcoming bill 60 25`"
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Upcoming error:", err);
      return bot.sendMessage(chatId, "Error generating upcoming list.");
    }
  });
};

module.exports.help = {
  command: "upcoming",
  category: "General",
  summary: "Show upcoming recurring events.",
  usage: [
    "/upcoming",
    "/upcoming <bill|income>",
    "/upcoming <days>",
    "/upcoming <bill|income> <days> <limit>"
  ],
  args: [
    { name: "<bill|income>", description: "Optional filter." },
    { name: "<days>", description: "Optional day range. Defaults to 30." },
    { name: "<limit>", description: "Optional max rows. Defaults to 10." }
  ],
  examples: [
    "/upcoming",
    "/upcoming bill",
    "/upcoming 60",
    "/upcoming bill 60 25"
  ],
  notes: [
    "Default range is 30 days.",
    "Default limit is 10 events."
  ]
};
