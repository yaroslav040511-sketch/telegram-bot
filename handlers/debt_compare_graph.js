// handlers/debt_compare_graph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerDebtCompareGraphHandler(bot, deps) {
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

      // 1) interest accrual
      for (const d of debts) {
        if (d.balance <= 0.005) continue;

        const monthlyRate = d.apr / 100 / 12;
        const interest = d.balance * monthlyRate;
        d.balance += interest;
        totalInterest += interest;
      }

      // 2) minimums first
      const remaining = activeDebts(debts);
      sortDebts(remaining, mode);

      let paymentPool = monthlyBudget;

      for (const d of remaining) {
        if (paymentPool <= 0) break;

        const minPay = Math.min(d.minimum, d.balance, paymentPool);
        d.balance -= minPay;
        paymentPool -= minPay;
      }

      // 3) extra to target debt(s)
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

      // cleanup tiny rounding leftovers
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

  bot.onText(/^\/debt_compare_graph\s+(\d+(\.\d+)?)$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const extra = Number(match[1]);

    try {
      if (!Number.isFinite(extra) || extra < 0) {
        return bot.sendMessage(chatId, "Usage: /debt_compare_graph <extra>");
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
      summary += `Extra Payment: $${extra.toFixed(2)} / month\n\n`;
      summary += `Snowball:  ${snowball.months} months, $${snowball.totalInterest.toFixed(2)} interest\n`;
      summary += `Avalanche: ${avalanche.months} months, $${avalanche.totalInterest.toFixed(2)} interest\n\n`;

      if (interestSaved > 0) {
        summary += `Avalanche saves $${interestSaved.toFixed(2)} in interest.`;
      } else if (interestSaved < 0) {
        summary += `Snowball saves $${Math.abs(interestSaved).toFixed(2)} in interest.`;
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
