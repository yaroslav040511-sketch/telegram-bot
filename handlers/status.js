// handlers/status.js
module.exports = function registerStatusHandler(bot, deps) {
  const { db, ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  function parseYMD(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }

  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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
      if (!Array.isArray(postings)) return 0;
      const bankLine = postings.find((p) => p.account === "assets:bank");
      return Number(bankLine?.amount) || 0;
    } catch {
      return 0;
    }
  }

  bot.onText(/^\/status(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;

    try {
      // current bank balance
      const balances = ledgerService.getBalances();
      const bank = balances.find((b) => b.account === "assets:bank");
      const bankBalance = Number(bank?.balance) || 0;

      // last 30d posted income/expenses
      const rows = db.prepare(`
        SELECT
          a.type as type,
          SUM(p.amount) as total
        FROM transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
        WHERE t.date >= date('now', '-30 days')
          AND (a.type = 'INCOME' OR a.type = 'EXPENSES')
        GROUP BY a.type
      `).all();

      let income30 = 0;
      let expenses30 = 0;

      for (const r of rows) {
        const v = Math.abs(Number(r.total) || 0);
        if (r.type === "INCOME") income30 = v;
        if (r.type === "EXPENSES") expenses30 = v;
      }

      const net30 = income30 - expenses30;

      // recurring next 30d (expanded occurrences)
      const recurring = db.prepare(`
        SELECT id, description, postings_json, frequency, next_due_date
        FROM recurring_transactions
        ORDER BY date(next_due_date) ASC, id ASC
      `).all();

      const today = new Date();
      today.setHours(12, 0, 0, 0);

      const end = new Date(today);
      end.setDate(end.getDate() + 30);
      end.setHours(12, 0, 0, 0);

      let recurringNet30 = 0;
      let nextItems = [];

      for (const r of recurring) {
        let due = parseYMD(r.next_due_date);
        if (!due) continue;

        let guard = 0;
        const bankAmt = extractBankAmount(r.postings_json);

        while (due <= end && guard < 500) {
          if (due >= today) {
            recurringNet30 += bankAmt;

            if (nextItems.length < 3) {
              nextItems.push({
                date: ymd(due),
                description: r.description,
                amount: bankAmt
              });
            }
          }

          const next = nextDueDate(due, r.frequency);
          if (!next) break;
          due = next;
          guard += 1;
        }
      }

      const projectedNet30 = bankBalance + recurringNet30;

      // debt snapshot
      const debtRow = db.prepare(`
        SELECT
          IFNULL(SUM(balance), 0) as totalDebt,
          IFNULL(SUM(minimum), 0) as totalMinimums,
          IFNULL(SUM(balance * apr), 0) as weightedNumerator
        FROM debts
      `).get();

      const totalDebt = Number(debtRow?.totalDebt) || 0;
      const totalMinimums = Number(debtRow?.totalMinimums) || 0;
      const weightedApr =
        totalDebt > 0
          ? (Number(debtRow?.weightedNumerator) || 0) / totalDebt
          : 0;

      let out = "📊 Status\n\n";
      out += "```\n";
      out += `Balance:        ${money(bankBalance)}\n`;
      out += `30d Income:     ${money(income30)}\n`;
      out += `30d Expenses:   ${money(expenses30)}\n`;
      out += `30d Net:        ${net30 >= 0 ? "+" : "-"}${money(Math.abs(net30))}\n`;
      out += `Recurring 30d:  ${recurringNet30 >= 0 ? "+" : "-"}${money(Math.abs(recurringNet30))}\n`;
      out += `Projected 30d:  ${money(projectedNet30)}\n`;
      out += `Debt Total:     ${money(totalDebt)}\n`;
      out += `Debt Min/Mon:   ${money(totalMinimums)}\n`;
      out += `Weighted APR:   ${weightedApr.toFixed(2)}%\n`;
      out += "```";

      if (nextItems.length) {
        out += "\nNext events:\n";
        for (const item of nextItems) {
          const sign = item.amount >= 0 ? "+" : "-";
          out += `• ${item.date}  ${item.description}  ${sign}${money(Math.abs(item.amount))}\n`;
        }
      }

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("status error:", err);
      return bot.sendMessage(chatId, "Error generating status.");
    }
  });
};
