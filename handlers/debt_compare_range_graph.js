// handlers/debt_compare_range_graph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerDebtCompareRangeGraphHandler(bot, deps) {
  const { db } = deps;

  function cloneDebts(rows) {
    return rows.map((r) => ({
      name: r.name,
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

  function runSimulation(rows, mode, extra) {
    const debts = cloneDebts(rows);

    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const monthlyBudget = totalMinimums + extra;

    if (monthlyBudget <= 0) {
      return { months: null, interest: null };
    }

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
    }

    if (months >= 1200) {
      return { months: null, interest: null };
    }

    return {
      months,
      interest: totalInterest
    };
  }

  bot.onText(
    /^\/debt_compare_range_graph\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)$/i,
    async (msg, match) => {
      const chatId = msg.chat.id;

      try {
        const start = Number(match[1]);
        const end = Number(match[3]);
        const step = Number(match[5]);

        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          !Number.isFinite(step) ||
          start < 0 ||
          end < start ||
          step <= 0
        ) {
          return bot.sendMessage(
            chatId,
            "Usage: /debt_compare_range_graph <start> <end> <step>\nExample: /debt_compare_range_graph 100 500 100"
          );
        }

        const rows = db.prepare(`
          SELECT name, balance, apr, minimum
          FROM debts
        `).all();

        if (!rows.length) {
          return bot.sendMessage(chatId, "No debts recorded.");
        }

        const labels = [];
        const snowballInterest = [];
        const avalancheInterest = [];
        const snowballMonths = [];
        const avalancheMonths = [];

        for (let extra = start; extra <= end + 0.0001; extra += step) {
          const snow = runSimulation(rows, "snowball", extra);
          const ava = runSimulation(rows, "avalanche", extra);

          labels.push(`$${extra.toFixed(0)}`);
          snowballInterest.push(snow.interest == null ? null : Number(snow.interest.toFixed(2)));
          avalancheInterest.push(ava.interest == null ? null : Number(ava.interest.toFixed(2)));
          snowballMonths.push(snow.months);
          avalancheMonths.push(ava.months);
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
                label: "Snowball Interest",
                data: snowballInterest,
                borderWidth: 4,
                tension: 0.25,
                pointRadius: 4,
                fill: false,
                borderDash: [8, 6]
              },
              {
                label: "Avalanche Interest",
                data: avalancheInterest,
                borderWidth: 4,
                tension: 0.25,
                pointRadius: 4,
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
                  font: { size: 18 }
                },
                title: {
                  display: true,
                  text: "Extra Monthly Payment",
                  color: "#ffffff",
                  font: { size: 18 }
                },
                grid: {
                  color: "rgba(255,255,255,0.08)"
                }
              },
              y: {
                ticks: {
                  color: "#ffffff",
                  font: { size: 20 },
                  callback: (value) => "$" + Number(value).toLocaleString()
                },
                title: {
                  display: true,
                  text: "Total Interest Paid",
                  color: "#ffffff",
                  font: { size: 18 }
                },
                grid: {
                  color: "rgba(255,255,255,0.08)"
                }
              }
            }
          }
        };

        const image = await chartJSNodeCanvas.renderToBuffer(configuration);

        await bot.sendPhoto(chatId, image, {
          filename: "debt_compare_range_graph.png",
          contentType: "image/png"
        });

        let summary = "💳 Debt Compare Range Graph\n\n";

        for (let i = 0; i < labels.length; i++) {
          const sInt = snowballInterest[i];
          const aInt = avalancheInterest[i];
          const sMon = snowballMonths[i];
          const aMon = avalancheMonths[i];

          if (sInt == null || aInt == null || sMon == null || aMon == null) {
            summary += `• ${labels[i]}: unavailable\n`;
            continue;
          }

          const better =
            aInt + 0.005 < sInt
              ? `avalanche saves $${(sInt - aInt).toFixed(2)}`
              : sInt + 0.005 < aInt
                ? `snowball saves $${(aInt - sInt).toFixed(2)}`
                : "same interest";

          summary += `• ${labels[i]}: snowball ${sMon}m/$${sInt.toFixed(0)}, avalanche ${aMon}m/$${aInt.toFixed(0)} → ${better}\n`;
        }

        return bot.sendMessage(chatId, summary);
      } catch (err) {
        console.error("debt_compare_range_graph error:", err);
        return bot.sendMessage(chatId, "Error generating debt compare range graph.");
      }
    }
  );
};
