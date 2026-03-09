// handlers/forecast_graph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerForecastGraphHandler(bot, deps) {
  const { db, simulateCashflow, format } = deps;
  const { formatMoney, codeBlock } = format;

  function renderHelp() {
    return [
      "*\\/forecast_graph*",
      "Generate a 30-day forecast balance chart for `assets:bank` and show upcoming recurring items.",
      "",
      "*Usage*",
      "- `/forecast_graph`",
      "",
      "*Examples*",
      "- `/forecast_graph`",
      "",
      "*Notes*",
      "- Uses `simulateCashflow` with a 30-day horizon.",
      "- Reads the current starting balance from `assets:bank`."
    ].join("\n");
  }

  bot.onText(/^\/forecast_graph(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (raw) {
      if (/^(help|--help|-h)$/i.test(raw)) {
        return bot.sendMessage(chatId, renderHelp(), {
          parse_mode: "Markdown"
        });
      }

      return bot.sendMessage(
        chatId,
        [
          "The `/forecast_graph` command does not take arguments.",
          "",
          "Usage:",
          "`/forecast_graph`"
        ].join("\n"),
        { parse_mode: "Markdown" }
      );
    }

    try {
      const checking = db.prepare(`
        SELECT id
        FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(chatId, "Checking account `assets:bank` not found.", {
          parse_mode: "Markdown"
        });
      }

      const row = db.prepare(`
        SELECT IFNULL(SUM(amount), 0) as balance
        FROM postings
        WHERE account_id = ?
      `).get(checking.id);

      const currentBalance = Number(row?.balance) || 0;
      const result = simulateCashflow(db, currentBalance, checking.id, 30);

      const labels = ["Today"];
      const balances = [currentBalance];

      if (Array.isArray(result?.timeline) && result.timeline.length) {
        for (const evt of result.timeline) {
          labels.push(String(evt.date || ""));
          balances.push(Number(evt.balance) || 0);
        }
      }

      const minBalance = Math.min(...balances);
      const hasNegative = minBalance < 0;

      let firstNegativeDate = null;
      if (Array.isArray(result?.timeline) && result.timeline.length) {
        for (const evt of result.timeline) {
          const b = Number(evt.balance) || 0;
          if (b < 0) {
            firstNegativeDate = evt.date;
            break;
          }
        }
      }

      const recurringLines = [];

      try {
        const recurring = db.prepare(`
          SELECT id, hash, description, frequency, next_due_date, postings_json
          FROM recurring_transactions
          ORDER BY date(next_due_date) ASC, id ASC
          LIMIT 10
        `).all();

        for (const r of recurring) {
          let amt = null;

          try {
            const postings = JSON.parse(r.postings_json);
            if (Array.isArray(postings)) {
              const bankLine = postings.find((p) => p.account === "assets:bank");
              if (bankLine) amt = Math.abs(Number(bankLine.amount) || 0);
            }
          } catch {
            // ignore malformed postings_json
          }

          const shortHash = String(r.hash || "").slice(0, 6);
          const date = String(r.next_due_date || "").padEnd(12);
          const desc = String(r.description || "").padEnd(20);
          const amount = (amt == null ? "" : formatMoney(amt)).padStart(12);
          const freq = `(${r.frequency})`;
          const ref = `#${r.id} ${shortHash}`;

          recurringLines.push(
            `${date}${desc}${amount}\n` +
            `             ${freq} ${ref}`
          );
        }
      } catch {
        // ignore recurring preview failure
      }

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
              label: "Projected Balance",
              data: balances,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 4,
              fill: true,
              borderColor: hasNegative ? "#ef4444" : "#22c55e",
              backgroundColor: hasNegative
                ? "rgba(239, 68, 68, 0.15)"
                : "rgba(34, 197, 94, 0.2)"
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
                font: { size: 20 },
                maxTicksLimit: 8
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
        filename: "forecast_graph.png",
        contentType: "image/png"
      });

      let summary = `Current Balance: ${formatMoney(currentBalance)}\n`;
      summary += `Projected 30-Day Minimum: ${formatMoney(minBalance)}\n`;

      if (hasNegative) {
        summary += `First negative date: ${firstNegativeDate || "(unknown)"}\n\n`;
        summary += "⚠️ Overdraft risk detected in the next 30 days.";
      } else {
        summary += "\n✅ No overdraft risk in the next 30 days.";
      }

      if (recurringLines.length) {
        summary += `\n\n📌 Upcoming recurring (next ${recurringLines.length}):\n`;
        summary += codeBlock(recurringLines.join("\n\n"));
      }

      return bot.sendMessage(chatId, summary, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("forecast_graph error:", err);
      return bot.sendMessage(chatId, "Error generating forecast graph.");
    }
  });
};

module.exports.help = {
  command: "forecast_graph",
  category: "Forecasting",
  summary: "Generate a 30-day forecast balance chart for assets:bank and show upcoming recurring items.",
  usage: [
    "/forecast_graph"
  ],
  examples: [
    "/forecast_graph"
  ],
  notes: [
    "Uses `simulateCashflow` with a 30-day horizon.",
    "Reads the current starting balance from `assets:bank`."
  ]
};
