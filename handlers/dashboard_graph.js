// handlers/dashboard_graph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerDashboardGraphHandler(bot, deps) {
  const { db, simulateCashflow } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`;
  }

  function monthDay(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  function getRecurringNetMonthly(recurring) {
    let income = 0;
    let bills = 0;

    for (const r of recurring) {
      try {
        const postings = JSON.parse(r.postings_json);
        const bankLine = Array.isArray(postings)
          ? postings.find((p) => p.account === "assets:bank")
          : null;

        if (!bankLine) continue;

        let mult = 0;
        switch ((r.frequency || "").toLowerCase()) {
          case "daily": mult = 30; break;
          case "weekly": mult = 4.33; break;
          case "monthly": mult = 1; break;
          case "yearly": mult = 1 / 12; break;
          default: mult = 0;
        }

        const amt = Number(bankLine.amount) || 0;
        const monthly = Math.abs(amt) * mult;

        if (amt > 0) income += monthly;
        if (amt < 0) bills += monthly;
      } catch { }
    }

    return income - bills;
  }

  function simulateDebtSeries(rows, extra, points, daysPerMonth = 30) {
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
      while (series.length < points) series.push(0);
      return series;
    }

    let dayIndex = 1;
    let nextMonthDay = daysPerMonth;

    while (series.length < points) {
      if (dayIndex < nextMonthDay) {
        series.push(debts.reduce((sum, d) => sum + d.balance, 0));
        dayIndex += 1;
        continue;
      }

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

      series.push(debts.reduce((sum, d) => sum + d.balance, 0));
      dayIndex += 1;
      nextMonthDay += daysPerMonth;
    }

    return series.slice(0, points);
  }

  bot.onText(/^\/dashboard_graph(@\w+)?(?:\s+(\d{1,3}))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;

    try {
      const horizon = match[2] ? Number(match[2]) : 30;

      if (!Number.isInteger(horizon) || horizon < 7 || horizon > 120) {
        return bot.sendMessage(chatId, "Usage: /dashboard_graph [days]\nExample: /dashboard_graph 60");
      }

      const checking = db.prepare(`
        SELECT id FROM accounts
        WHERE name = 'assets:bank'
      `).get();

      if (!checking) {
        return bot.sendMessage(chatId, "Checking account not found.");
      }

      const balanceRow = db.prepare(`
        SELECT IFNULL(SUM(amount), 0) as balance
        FROM postings
        WHERE account_id = ?
      `).get(checking.id);

      const currentBalance = Number(balanceRow?.balance) || 0;
      const result = simulateCashflow(db, currentBalance, checking.id, horizon);
      const timeline = Array.isArray(result.timeline) ? result.timeline : [];

      const recurring = db.prepare(`
        SELECT description, postings_json, next_due_date, frequency
        FROM recurring_transactions
      `).all();

      let nextIncome = null;
      for (const r of recurring) {
        try {
          const postings = JSON.parse(r.postings_json);
          const bankLine = Array.isArray(postings)
            ? postings.find((p) => p.account === "assets:bank")
            : null;

          if (bankLine && Number(bankLine.amount) > 0) {
            const d = new Date(r.next_due_date);
            if (!nextIncome || d < nextIncome.date) {
              nextIncome = {
                date: d,
                amount: Number(bankLine.amount) || 0,
                description: r.description
              };
            }
          }
        } catch { }
      }

      const labels = ["Today"];
      const bankSeries = [currentBalance];
      const dateToIndex = new Map();

      for (let i = 0; i < timeline.length; i++) {
        labels.push(monthDay(timeline[i].date));
        bankSeries.push(Number(timeline[i].balance) || 0);
        dateToIndex.set(String(timeline[i].date), i + 1);
      }

      let lowestIdx = 0;
      let lowestBal = currentBalance;
      for (let i = 1; i < bankSeries.length; i++) {
        if (bankSeries[i] < lowestBal) {
          lowestBal = bankSeries[i];
          lowestIdx = i;
        }
      }

      const lowMarker = bankSeries.map(() => null);
      lowMarker[lowestIdx] = lowestBal;

      const incomeMarker = bankSeries.map(() => null);
      if (nextIncome) {
        const idx = dateToIndex.get(nextIncome.date.toISOString().slice(0, 10));
        if (idx != null) incomeMarker[idx] = bankSeries[idx];
      }

      const debtRows = getDebtRows();
      const recurringNetMonthly = getRecurringNetMonthly(recurring);
      const debtSeries = simulateDebtSeries(
        debtRows,
        Math.max(0, recurringNetMonthly),
        bankSeries.length,
        30
      );

      const netWorthSeries = bankSeries.map((bank, i) => bank - (Number(debtSeries[i]) || 0));

      const minY = Math.min(...bankSeries, ...debtSeries, ...netWorthSeries);
      const maxY = Math.max(...bankSeries, ...debtSeries, ...netWorthSeries);
      let pad = (maxY - minY) * 0.12;
      if (!Number.isFinite(pad) || pad === 0) {
        pad = Math.max(50, Math.abs(maxY) * 0.05, Math.abs(minY) * 0.05);
      }

      const chartJSNodeCanvas = new ChartJSNodeCanvas({
        width: 1100,
        height: 700,
        backgroundColour: "#0f172a"
      });

      const maxTicks =
        horizon <= 30 ? 12 :
          horizon <= 60 ? 14 :
            16;

      const configuration = {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Bank",
              data: bankSeries,
              borderWidth: 4,
              tension: 0.2,
              pointRadius: horizon <= 45 ? 3 : 2,
              fill: false,
              borderDash: [8, 6]
            },
            {
              label: "Debt",
              data: debtSeries,
              borderWidth: 4,
              tension: 0.2,
              pointRadius: horizon <= 45 ? 2 : 1,
              fill: false,
              borderDash: [2, 6]
            },
            {
              label: "Net Worth",
              data: netWorthSeries,
              borderWidth: 4,
              tension: 0.2,
              pointRadius: horizon <= 45 ? 3 : 2,
              fill: false
            },
            {
              label: "Lowest Balance",
              data: lowMarker,
              showLine: false,
              pointRadius: 8,
              pointHoverRadius: 10,
              pointBorderWidth: 2
            },
            {
              label: "Next Income",
              data: incomeMarker,
              showLine: false,
              pointRadius: 8,
              pointHoverRadius: 10,
              pointBorderWidth: 2
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
                font: { size: 22 }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: "#ffffff",
                font: { size: 16 },
                maxTicksLimit: maxTicks
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
                font: { size: 18 },
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
        filename: "dashboard_graph.png",
        contentType: "image/png"
      });

      const endBalance = bankSeries[bankSeries.length - 1];
      let summary = "📊 Dashboard Graph\n\n";
      summary += `Horizon: ${horizon} day(s)\n`;
      summary += `Bank Now: ${money(currentBalance)}\n`;
      summary += `Lowest Balance: ${money(lowestBal)}\n`;
      summary += `End ${horizon} Days: ${money(endBalance)}\n`;
      if (nextIncome) {
        summary += `Next Income: ${money(nextIncome.amount)} on ${nextIncome.date.toISOString().slice(0, 10)}`;
      }

      return bot.sendMessage(chatId, summary);
    } catch (err) {
      console.error("dashboard_graph error:", err);
      return bot.sendMessage(chatId, "Error generating dashboard graph.");
    }
  });
};
