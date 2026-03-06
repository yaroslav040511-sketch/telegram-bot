// handlers/forecastgraph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

function money(n) {
  const x = Number(n) || 0;
  return "$" + x.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

module.exports = function registerForecastGraphHandler(bot, deps) {
  const { db, simulateCashflow } = deps;

  bot.onText(/^\/forecastgraph(@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      const checking = db.prepare(`
        SELECT id FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(chatId, "Checking account assets:bank not found.");
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

      if (result?.timeline?.length) {
        for (const evt of result.timeline) {
          labels.push(evt.date);
          balances.push(Number(evt.balance) || 0);
        }
      }

      const minBalance = Math.min(...balances);
      const hasNegative = minBalance < 0;

      let firstNegativeDate = null;
      if (result?.timeline?.length) {
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
          } catch { }

          const shortHash = String(r.hash || "").slice(0, 6);

          const date = String(r.next_due_date || "").padEnd(12);
          const desc = String(r.description || "").padEnd(20);
          const amount = (amt == null ? "" : money(amt)).padStart(12);

          const freq = `(${r.frequency})`;
          const ref = `#${r.id} ${shortHash}`;

          recurringLines.push(
            `${date}${desc}${amount}\n` +
            `             ${freq} ${ref}`
          );
        }
      } catch { }

      const width = 1000;
      const height = 600;

      const chartJSNodeCanvas = new ChartJSNodeCanvas({
        width,
        height,
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
              ticks: { color: "#ffffff", font: { size: 20 }, maxTicksLimit: 8 },
              grid: { color: "rgba(255,255,255,0.08)" }
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
        filename: "forecast.png",
        contentType: "image/png"
      });

      let summary = `Current Balance: ${money(currentBalance)}\n`;
      summary += `Projected 30-Day Minimum: ${money(minBalance)}\n`;

      if (hasNegative) {
        summary += `First negative date: ${firstNegativeDate || "(unknown)"}\n\n`;
        summary += "⚠️ Overdraft risk detected in the next 30 days.";
      } else {
        summary += "\n✅ No overdraft risk in the next 30 days.";
      }

      if (recurringLines.length) {
        summary += `\n\n📌 Upcoming recurring (next ${recurringLines.length}):\n`;
        summary += "```\n";
        summary += recurringLines.join("\n\n");
        summary += "\n```";
      }

      return bot.sendMessage(chatId, summary, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("Forecast graph error:", err);
      return bot.sendMessage(chatId, "Error generating forecast graph.");
    }
  });
};
