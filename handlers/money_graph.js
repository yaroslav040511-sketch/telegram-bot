// handlers/money_graph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerMoneyGraphHandler(bot, deps) {
  const { db, ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  function monthlyMultiplier(freq) {
    switch ((freq || "").toLowerCase()) {
      case "daily": return 30;
      case "weekly": return 4.33;
      case "monthly": return 1;
      case "yearly": return 1 / 12;
      default: return 0;
    }
  }

  function getBankBalance() {
    const balances = ledgerService.getBalances();
    const bank = balances.find((b) => b.account === "assets:bank");
    return Number(bank?.balance) || 0;
  }

  function getRecurringMonthlyNet() {
    const rows = db.prepare(`
      SELECT postings_json, frequency
      FROM recurring_transactions
    `).all();

    let income = 0;
    let bills = 0;

    for (const r of rows) {
      try {
        const postings = JSON.parse(r.postings_json);
        const bankLine = Array.isArray(postings)
          ? postings.find((p) => p.account === "assets:bank")
          : null;

        if (!bankLine) continue;

        const amt = Number(bankLine.amount) || 0;
        const monthly = Math.abs(amt) * monthlyMultiplier(r.frequency);

        if (amt > 0) income += monthly;
        if (amt < 0) bills += monthly;
      } catch { }
    }

    return income - bills;
  }

  function getDebtRows() {
    return db.prepare(`
      SELECT name, balance, apr, minimum
      FROM debts
    `).all().map((r) => ({
      name: r.name,
      balance: Number(r.balance) || 0,
      apr: Number(r.apr) || 0,
      minimum: Number(r.minimum) || 0
    }));
  }

  function monthLabels(monthsToShow = 12) {
    const labels = [];
    const d = new Date();
    d.setDate(1);

    for (let i = 0; i <= monthsToShow; i++) {
      const x = new Date(d.getFullYear(), d.getMonth() + i, 1);
      labels.push(
        x.toLocaleString("en-US", {
          month: "short",
          year: i === 0 ? undefined : "2-digit"
        })
      );
    }

    return labels;
  }

  function simulateDebtSeries(rows, extra, monthsToShow = 12) {
    const debts = rows.map((r) => ({ ...r }));

    function sortDebts(arr) {
      arr.sort((a, b) => {
        const aprDiff = b.apr - a.apr;
        if (aprDiff !== 0) return aprDiff;
        return a.balance - b.balance;
      });
    }

    function activeDebts() {
      return debts.filter((d) => d.balance > 0.005);
    }

    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const monthlyBudget = totalMinimums + extra;

    const series = [debts.reduce((sum, d) => sum + d.balance, 0)];

    if (debts.length === 0 || monthlyBudget <= 0) {
      while (series.length < monthsToShow + 1) series.push(0);
      return { series, payoffMonths: debts.length === 0 ? 0 : null };
    }

    let months = 0;
    let payoffMonths = null;

    while (months < monthsToShow) {
      months += 1;

      if (activeDebts().length > 0) {
        for (const d of debts) {
          if (d.balance <= 0.005) continue;
          const monthlyRate = d.apr / 100 / 12;
          d.balance += d.balance * monthlyRate;
        }

        const remaining = activeDebts();
        sortDebts(remaining);

        let paymentPool = monthlyBudget;

        for (const d of remaining) {
          if (paymentPool <= 0) break;
          const minPay = Math.min(d.minimum, d.balance, paymentPool);
          d.balance -= minPay;
          paymentPool -= minPay;
        }

        let targets = activeDebts();
        sortDebts(targets);

        while (paymentPool > 0 && targets.length > 0) {
          const target = targets[0];
          const pay = Math.min(target.balance, paymentPool);
          target.balance -= pay;
          paymentPool -= pay;

          targets = activeDebts();
          sortDebts(targets);
        }

        for (const d of debts) {
          if (d.balance < 0.005) d.balance = 0;
        }

        if (activeDebts().length === 0 && payoffMonths === null) {
          payoffMonths = months;
        }
      }

      series.push(debts.reduce((sum, d) => sum + d.balance, 0));
    }

    return { series, payoffMonths };
  }

  bot.onText(/^\/money_graph(@\w+)?(?:\s+(\d{1,2}))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const horizon = match[2] ? Number(match[2]) : 12;

      if (!Number.isInteger(horizon) || horizon < 1 || horizon > 60) {
        return bot.sendMessage(chatId, "Usage: /money_graph [months]\nExample: /money_graph 24");
      }

      const bankNow = getBankBalance();
      const recurringNet = getRecurringMonthlyNet();
      const debtRows = getDebtRows();

      const labels = monthLabels(horizon);

      const bankSeries = [bankNow];
      for (let i = 1; i <= horizon; i++) {
        bankSeries.push(bankNow + recurringNet * i);
      }

      const debtExtra = Math.max(0, recurringNet);
      const debtResult = simulateDebtSeries(debtRows, debtExtra, horizon);
      const debtSeries = debtResult.series;

      const netWorthSeries = bankSeries.map((bank, i) => bank - (Number(debtSeries[i]) || 0));

      const minY = Math.min(...bankSeries, ...debtSeries, ...netWorthSeries);
      const maxY = Math.max(...bankSeries, ...debtSeries, ...netWorthSeries);

      let pad = (maxY - minY) * 0.12;
      if (!Number.isFinite(pad) || pad === 0) {
        pad = Math.max(50, Math.abs(maxY) * 0.05, Math.abs(minY) * 0.05);
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
              label: "Bank",
              data: bankSeries,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 3,
              fill: false,
              borderDash: [8, 6]
            },
            {
              label: "Debt",
              data: debtSeries,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 3,
              fill: false,
              borderDash: [8, 6]
            },
            {
              label: "Net Worth",
              data: netWorthSeries,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 3,
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
                maxTicksLimit: horizon <= 12 ? horizon + 1 : 10
              },
              grid: {
                color: "rgba(255,255,255,0.08)"
              }
            },
            y: {
              suggestedMin: minY - pad,
              suggestedMax: maxY + pad,
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
        filename: "money_graph.png",
        contentType: "image/png"
      });

      const debtNow = debtSeries[0];
      const netWorthNow = netWorthSeries[0];
      const bankEnd = bankSeries[bankSeries.length - 1];
      const debtEnd = debtSeries[debtSeries.length - 1];
      const netWorthEnd = netWorthSeries[netWorthSeries.length - 1];

      let summary = "💰 Money Graph\n\n";
      summary += `Now → Bank ${money(bankNow)}, Debt ${money(debtNow)}, Net Worth ${money(netWorthNow)}\n`;
      summary += `${horizon}m → Bank ${money(bankEnd)}, Debt ${money(debtEnd)}, Net Worth ${money(netWorthEnd)}`;

      return bot.sendMessage(chatId, summary);
    } catch (err) {
      console.error("money_graph error:", err);
      return bot.sendMessage(chatId, "Error generating money graph.");
    }
  });
};
