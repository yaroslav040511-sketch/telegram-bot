// handlers/cashflow_detail.js
module.exports = function registerCashflowDetailHandler(bot, deps) {
  const { db, format, finance } = deps;
  const { formatMoney, codeBlock } = format;
  const { monthlyMultiplier } = finance;

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

  function renderHelp() {
    return [
      "*\\/cashflow_detail*",
      "Show a recurring cashflow breakdown by bill and income line item.",
      "",
      "*Usage*",
      "- `/cashflow_detail`",
      "",
      "*Examples*",
      "- `/cashflow_detail`"
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), { parse_mode: "Markdown" });
  }

  bot.onText(/^\/cashflow_detail(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return sendHelp(chatId);
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/cashflow_detail` command does not take arguments.",
          "",
          "Usage:",
          "`/cashflow_detail`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const rows = db.prepare(`
        SELECT id, hash, description, postings_json, frequency, next_due_date
        FROM recurring_transactions
        ORDER BY id ASC
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No recurring items saved.");
      }

      let income = 0;
      let bills = 0;
      const lines = [];

      for (const r of rows) {
        const mult = monthlyMultiplier(r.frequency);
        if (!mult) continue;

        const bankAmt = extractBankAmount(r.postings_json);
        if (bankAmt == null) continue;

        const monthly = bankAmt * mult;
        const kind = monthly >= 0 ? "income" : "bill";
        const absMonthly = Math.abs(monthly);

        if (kind === "income") income += absMonthly;
        else bills += absMonthly;

        lines.push({
          id: r.id,
          ref: String(r.hash || "").slice(0, 6),
          description: r.description,
          frequency: r.frequency,
          next: r.next_due_date,
          kind,
          monthly: absMonthly
        });
      }

      const net = income - bills;
      const billsLines = lines.filter((l) => l.kind === "bill");
      const incomeLines = lines.filter((l) => l.kind === "income");

      let out = [
        "🧾 *Monthly Cashflow Detail (Recurring)*",
        "",
        codeBlock([
          `Income  ${formatMoney(income)}`,
          `Bills   ${formatMoney(bills)}`,
          `Net     ${net >= 0 ? "+" : "-"}${formatMoney(Math.abs(net))}`
        ].join("\n"))
      ].join("\n");

      if (billsLines.length) {
        out += "\n\nBills:\n";
        out += codeBlock(
          billsLines.map((l) =>
            `- ${formatMoney(l.monthly)}  ${l.description}  (${l.frequency}) next:${l.next}  #${l.id} ${l.ref}`
          ).join("\n")
        );
      }

      if (incomeLines.length) {
        out += "\n\nIncome:\n";
        out += codeBlock(
          incomeLines.map((l) =>
            `+ ${formatMoney(l.monthly)}  ${l.description}  (${l.frequency}) next:${l.next}  #${l.id} ${l.ref}`
          ).join("\n")
        );
      }

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Cashflow detail error:", err);
      return bot.sendMessage(chatId, "Error generating cashflow detail.");
    }
  });
};

module.exports.help = {
  command: "cashflow_detail",
  category: "General",
  summary: "Recurring cashflow breakdown.",
  usage: [
    "/cashflow_detail"
  ],
  examples: [
    "/cashflow_detail"
  ]
};
