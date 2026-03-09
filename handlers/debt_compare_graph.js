// handlers/debt_compare_graph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerDebtCompareGraphHandler(bot, deps) {
  const { db, format } = deps;
  const { formatMoney } = format;

  function cloneDebts(rows) {
    return rows.map((r) => ({
      name: String(r.name || ""),
      balance: Number(r.balance) || 0,
      apr: Number(r.apr) || 0,
      minimum: Number(r.minimum) || 0
    }));
  }

  function sortDebts(debts, mode) {
    if (mode === "snowball") {
      debts.sort((a, b) => {
        const balDiff = a.balance - b.balance;
        if (balDiff !== 0) return balDiff;
        return b.apr - a.apr;
      });
    } else {
      debts.sort((a, b) => {
        const aprDiff = b.apr - a.apr;
        if (aprDiff !== 0) return aprDiff;
        return a.balance - b.balance;
      });
    }
  }

  function activeDebts(debts) {
    return debts.filter((d) => d.balance > 0.005);
  }

  function simulateSeries(rows, mode, extra) {
    const debts = cloneDebts(rows);

    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const monthlyBudget = totalMinimums + extra;

    if (monthlyBudget <= 0) {
      throw new Error("Monthly debt budget must be greater than 0.");
    }

    const totals = [debts.reduce((sum, d) => sum + d.balance, 0)];

    let months = 0;
    let totalInterest = 0;

    while (activeDebts(debts).length > 0 && months < 1200) {
      months += 1;

      for (const d of debts) {
        if (d.balance <= 0.005) continue;

        const monthlyRate = d.apr / 100 / 12;
        const interest = d.balance * monthlyRate;
        d.balance += interest;
        totalInterest += interest;
      }

      const remaining = activeDebts(debts);
      sortDebts(remaining, mode);

      let paymentPool = monthlyBudget;

      for (const d of remaining) {
        if (paymentPool <= 0) break;

        const minPay = Math.min(d.minimum, d.balance, paymentPool);
        d.balance -= minPay;
        paymentPool -= minPay;
      }

      let targets = activeDebts(debts);
      sortDebts(targets, mode);

      while (paymentPool > 0 && targets.length > 0) {
        const target = targets[0];
        const pay = Math.min(target.balance, paymentPool);
        target.balance -= pay;
        paymentPool -= pay;

        targets = activeDebts(debts);
        sortDebts(targets, mode);
      }

      for (const d of debts) {
        if (d.balance < 0.005) d.balance = 0;
      }

      totals.push(debts.reduce((sum, d) => sum + d.balance, 0));
    }

    if (months >= 1200) {
      throw new Error("Simulation exceeded safe limit.");
    }

    return {
      totals,
      months,
      totalInterest,
      startingDebt: totals[0]
    };
  }

  function renderHelp() {
    return [
      "*\\/debt_compare_graph*",
      "Generate a comparison graph of snowball versus avalanche debt payoff using the same extra monthly payment.",
      "",
      "*Usage*",
      "- `/debt_compare_graph <extra>`",
      "",
      "*Arguments*",
      "- `<extra>` — Extra monthly payment on top of minimums. Must be zero or greater.",
      "",
      "*Examples*",
      "- `/debt_compare_graph 100`",
      "- `/debt_compare_graph 250.50`",
      "",
      "*Notes*",
      "- Uses your current debts table.",
      "- Graph compares remaining debt balance over time for both strategies."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debt_compare_graph(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const extra = Number(raw);

      if (!Number.isFinite(extra) || extra < 0) {
        return bot.sendMessage(
          chatId,
          [
            "Extra payment must be zero or greater.",
            "",
            "Usage:",
            "`/debt_compare_graph <extra>`",
            "",
            "Example:",
            "`/debt_compare_graph 100`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const rows = db.prepare(`
        SELECT name, balance, apr, minimum
        FROM debts
      `).all();

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      const snowball = simulateSeries(rows, "snowball", extra);
      const avalanche = simulateSeries(rows, "avalanche", extra);

      const maxMonths = Math.max(snowball.months, avalanche.months);
      const labels = Array.from({ length: maxMonths + 1 }, (_, i) =>
        i === 0 ? "Start" : `M${i}`
      );

      function padSeries(series, length) {
        const out = [...series];
        while (out.length < length) out.push(0);
        return out;
      }

      const snowballSeries = padSeries(snowball.totals, labels.length);
      const avalancheSeries = padSeries(avalanche.totals, labels.length);

      const chartJSNodeCanvas = new ChartJSNodeCanvas({
        width: 1000,
        height: 600,
        backgroundColour: "#0f172a"
      });

      const configuration = {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Snowball",
              data: snowballSeries,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 2,
              fill: false,
              borderDash: [8, 6]
            },
            {
              label: "Avalanche",
              data: avalancheSeries,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 2,
              fill: false
            }
          ]
        },
        options: {
          responsive: false,
          layout: { padding: 40 },
          plugins: {
            legend: {
              labels: {
                color: "#ffffff",
                font: { size: 24 }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: "#ffffff",
                font: { size: 18 },
                maxTicksLimit: 10
              },
              grid: {
                color: "rgba(255,255,255,0.08)"
              }
            },
            y: {
              ticks: {
                color: "#ffffff",
                font: { size: 22 },
                callback: (value) => "$" + Number(value).toLocaleString()
              },
              grid: {
                color: (ctx) =>
                  ctx.tick.value === 0
                    ? "rgba(255,255,255,0.35)"
                    : "rgba(255,255,255,0.08)"
              }
            }
          }
        }
      };

      const image = await chartJSNodeCanvas.renderToBuffer(configuration);

      await bot.sendPhoto(chatId, image, {
        filename: "debt_compare_graph.png",
        contentType: "image/png"
      });

      const interestSaved = snowball.totalInterest - avalanche.totalInterest;

      let summary = "💳 Debt Compare Graph\n\n";
      summary += `Extra Payment: ${formatMoney(extra)} / month\n\n`;
      summary += `Snowball:  ${snowball.months} months, ${formatMoney(snowball.totalInterest)} interest\n`;
      summary += `Avalanche: ${avalanche.months} months, ${formatMoney(avalanche.totalInterest)} interest\n\n`;

      if (interestSaved > 0) {
        summary += `Avalanche saves ${formatMoney(interestSaved)} in interest.`;
      } else if (interestSaved < 0) {
        summary += `Snowball saves ${formatMoney(Math.abs(interestSaved))} in interest.`;
      } else {
        summary += "Both strategies cost the same in interest.";
      }

      return bot.sendMessage(chatId, summary);
    } catch (err) {
      console.error("debt_compare_graph error:", err);
      return bot.sendMessage(chatId, "Error generating debt compare graph.");
    }
  });
};

module.exports.help = {
  command: "debt_compare_graph",
  category: "Debt",
  summary: "Generate a comparison graph of snowball versus avalanche debt payoff using the same extra monthly payment.",
  usage: [
    "/debt_compare_graph <extra>"
  ],
  args: [
    { name: "<extra>", description: "Extra monthly payment on top of minimums. Must be zero or greater." }
  ],
  examples: [
    "/debt_compare_graph 100",
    "/debt_compare_graph 250.50"
  ],
  notes: [
    "Uses your current debts table.",
    "Graph compares remaining debt balance over time for both strategies."
  ]
};
