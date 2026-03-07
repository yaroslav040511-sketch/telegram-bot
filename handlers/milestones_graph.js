// handlers/milestones_graph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerMilestonesGraphHandler(bot, deps) {
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

  function futureMonthLabel(monthsAhead) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthsAhead);
    return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
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

    return {
      income,
      bills,
      net: income - bills
    };
  }

  function getMonthlyExpenses() {
    const row = db.prepare(`
      SELECT IFNULL(SUM(p.amount), 0) as total
      FROM transactions t
      JOIN postings p ON p.transaction_id = t.id
      JOIN accounts a ON a.id = p.account_id
      WHERE strftime('%Y-%m', t.date) = strftime('%Y-%m', 'now')
        AND a.type = 'EXPENSES'
    `).get();

    return Math.abs(Number(row?.total) || 0);
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

  function simulateDebtPayoffMonths(rows, mode, extra) {
    const debts = rows.map((r) => ({ ...r }));

    function sortDebts(arr) {
      if (mode === "snowball") {
        arr.sort((a, b) => {
          const balDiff = a.balance - b.balance;
          if (balDiff !== 0) return balDiff;
          return b.apr - a.apr;
        });
      } else {
        arr.sort((a, b) => {
          const aprDiff = b.apr - a.apr;
          if (aprDiff !== 0) return aprDiff;
          return a.balance - b.balance;
        });
      }
    }

    function activeDebts() {
      return debts.filter((d) => d.balance > 0.005);
    }

    const totalMinimums = debts.reduce((sum, d) => sum + d.minimum, 0);
    const monthlyBudget = totalMinimums + extra;

    if (debts.length === 0) return 0;
    if (monthlyBudget <= 0) return null;

    let months = 0;

    while (activeDebts().length > 0 && months < 1200) {
      months += 1;

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
    }

    return months >= 1200 ? null : months;
  }

  function simulateNetWorthMilestoneMonths(startBalance, monthlyNet, debtRows, targets) {
    const debts = debtRows.map((r) => ({ ...r }));
    const results = {};
    const sortedTargets = [...targets].sort((a, b) => a - b);

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
    const debtExtra = Math.max(0, monthlyNet);
    const monthlyDebtBudget = totalMinimums + debtExtra;

    let cash = startBalance;
    let months = 0;

    while (months < 1200) {
      const totalDebt = debts.reduce((sum, d) => sum + d.balance, 0);
      const netWorth = cash - totalDebt;

      for (const t of sortedTargets) {
        if (results[t] == null && netWorth >= t) {
          results[t] = months;
        }
      }

      if (sortedTargets.every((t) => results[t] != null)) break;

      months += 1;
      cash += monthlyNet;

      if (activeDebts().length > 0 && monthlyDebtBudget > 0) {
        for (const d of debts) {
          if (d.balance <= 0.005) continue;
          const monthlyRate = d.apr / 100 / 12;
          d.balance += d.balance * monthlyRate;
        }

        const remaining = activeDebts();
        sortDebts(remaining);

        let paymentPool = monthlyDebtBudget;

        for (const d of remaining) {
          if (paymentPool <= 0) break;
          const minPay = Math.min(d.minimum, d.balance, paymentPool);
          d.balance -= minPay;
          paymentPool -= minPay;
        }

        let targetsNow = activeDebts();
        sortDebts(targetsNow);

        while (paymentPool > 0 && targetsNow.length > 0) {
          const target = targetsNow[0];
          const pay = Math.min(target.balance, paymentPool);
          target.balance -= pay;
          paymentPool -= pay;

          targetsNow = activeDebts();
          sortDebts(targetsNow);
        }

        for (const d of debts) {
          if (d.balance < 0.005) d.balance = 0;
        }
      }
    }

    return results;
  }

  function simulateFIMonths(startBalance, monthlySave, annualReturn, fiTarget) {
    if (monthlySave <= 0 || fiTarget <= 0) return null;
    if (startBalance >= fiTarget) return 0;

    const monthlyRate = annualReturn / 100 / 12;
    let balance = startBalance;
    let months = 0;

    while (balance < fiTarget && months < 1200) {
      balance = balance * (1 + monthlyRate) + monthlySave;
      months += 1;
    }

    return months >= 1200 ? null : months;
  }

  bot.onText(/^\/milestones_graph(@\w+)?$/i, async (msg) => {
    const chatId = msg.chat.id;

    try {
      const bankBalance = getBankBalance();
      const recurring = getRecurringMonthlyNet();
      const monthlyExpenses = getMonthlyExpenses();
      const debtRows = getDebtRows();

      const debtMonths = simulateDebtPayoffMonths(
        debtRows,
        "avalanche",
        Math.max(0, recurring.net)
      );

      const annualExpenses = monthlyExpenses * 12;
      const fiTarget = annualExpenses > 0 ? annualExpenses * 25 : 0;
      const fiMonths = simulateFIMonths(
        bankBalance,
        Math.max(0, recurring.net),
        7,
        fiTarget
      );

      const targets = [10000, 25000, 50000, 100000];
      const milestoneMonths = simulateNetWorthMilestoneMonths(
        bankBalance,
        recurring.net,
        debtRows,
        targets
      );

      const labels = [];
      const values = [];
      const dateLabels = [];

      if (debtMonths != null) {
        labels.push("Debt Free");
        values.push(debtMonths);
        dateLabels.push(futureMonthLabel(debtMonths));
      }

      if (fiMonths != null) {
        labels.push("FI");
        values.push(fiMonths);
        dateLabels.push(futureMonthLabel(fiMonths));
      }

      for (const t of targets) {
        const months = milestoneMonths[t];
        if (months != null) {
          labels.push(`NW ${Math.round(t / 1000)}k`);
          values.push(months);
          dateLabels.push(futureMonthLabel(months));
        }
      }

      if (!labels.length) {
        return bot.sendMessage(chatId, "No milestone projections available.");
      }

      const chartJSNodeCanvas = new ChartJSNodeCanvas({
        width: 1000,
        height: 600,
        backgroundColour: "#0f172a"
      });

      const configuration = {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Months From Now",
              data: values,
              borderWidth: 2
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
            },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.raw} month(s)`
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: "#ffffff",
                font: { size: 18 }
              },
              grid: {
                color: "rgba(255,255,255,0.08)"
              }
            },
            y: {
              beginAtZero: true,
              ticks: {
                color: "#ffffff",
                font: { size: 20 }
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
        filename: "milestones_graph.png",
        contentType: "image/png"
      });

      let summary = "📍 Milestones Graph\n\n";
      for (let i = 0; i < labels.length; i++) {
        summary += `• ${labels[i]}: ${dateLabels[i]} (${values[i]}m)\n`;
      }

      return bot.sendMessage(chatId, summary);
    } catch (err) {
      console.error("milestones_graph error:", err);
      return bot.sendMessage(chatId, "Error generating milestones graph.");
    }
  });
};
