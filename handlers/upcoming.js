// handlers/upcoming.js
module.exports = function registerUpcomingHandler(bot, deps) {
  const { db } = deps;

  // Local date -> YYYY-MM-DD (NO toISOString)
  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Parse YYYY-MM-DD into a LOCAL date at midday (avoids DST/midnight issues)
  function parseYMD(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(y, mo, d, 12, 0, 0, 0); // midday
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
        if (d.getDate() !== day) d.setDate(0); // rollover
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

  // Usage:
  // /upcoming
  // /upcoming bill
  // /upcoming income
  // /upcoming 60
  // /upcoming 60 bill
  // /upcoming bill 60 25
  bot.onText(/^\/upcoming(?:\s+(.+))?$/i, (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const raw = (match[1] || "").trim();
      const tokens = raw ? raw.split(/\s+/) : [];

      let filter = "all"; // all | bill | income
      let days = 30;
      let limit = 10;

      // Parse tokens in any order:
      // - bill|income
      // - number => days
      // - number => limit (2nd number)
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
          "Usage: /upcoming [bill|income] [days<=365] [limit<=50]\nExample: /upcoming bill 60 25"
        );
      }

      if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
        return bot.sendMessage(
          chatId,
          "Usage: /upcoming [bill|income] [days<=365] [limit<=50]\nExample: /upcoming bill 60 25"
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

        // Filter early: this recurring won't change kind over time
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

      let out = `📌 Upcoming ${headerKind} (next ${shown.length} of ${events.length})\n\n`;

      for (const e of shown) {
        const ref = String(e.hash || "").slice(0, 6);
        const amtText = e.amount == null ? "" : `$${e.amount.toFixed(2)}`;
        out += `• ${e.date}  ${e.description}  ${amtText}  (${e.frequency})  #${e.id} ${ref}\n`;
      }

      out += `\nTip: /upcoming bill 60 25`;

      return bot.sendMessage(chatId, out);
    } catch (err) {
      console.error("Upcoming error:", err);
      return bot.sendMessage(chatId, "Error generating upcoming list.");
    }
  });
};
