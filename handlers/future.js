// handlers/future.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerFutureHandler(bot, deps) {
  const { db, ledgerService, format } = deps;
  const { formatMoney } = format;

  function monthlyMultiplier(freq) {
    switch ((freq || "").toLowerCase()) {
      case "daily":
        return 30;
      case "weekly":
        return 4.33;
      case "monthly":
        return 1;
      case "yearly":
        return 1 / 12;
      default:
        return 0;
    }
  }

  function getStartingAssets() {
    const balances = ledgerService.getBalances();

    let bank = 0;
    let savings = 0;

    for (const b of balances) {
      if (b.account === "assets:bank") bank = Number(b.balance) || 0;
      if (b.account === "assets:savings") savings = Number(b.balance) || 0;
    }

    return {
      bank,
      savings,
      total: bank + savings
    };
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
      } catch {
        // ignore malformed recurring rows
      }
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
      name: String(r.name || ""),
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

  function futureMonthLabel(monthsAhead) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthsAhead);
    return d.toLocaleString("en-US", { month: "long", year: "numeric" });
  }

  function simulateDebtSeries(rows, mode, extra, monthsToShow = 12) {
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

    const series = [debts.reduce((sum, d) => sum + d.balance, 0)];

    if (debts.length === 0 || monthlyBudget <= 0) {
      while (series.length < monthsToShow + 1) series.push(0);
      return { series, payoffMonths: 0 };
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

  function renderHelp() {
    return [
      "*\\/future*",
      "Generate a forward-looking graph of cash, debt, and net worth over the next few months.",
      "",
      "*Usage*",
      "- `/future`",
      "- `/future <months>`",
      "",
      "*Arguments*",
      "- `<months>` — Optional horizon from `1` to `60`. Defaults to `12`.",
      "",
      "*Examples*",
      "- `/future`",
      "- `/future 24`",
      "",
      "*Notes*",
      "- Starting assets include `assets:bank` and `assets:savings`.",
      "- Alias command: `/life_projection_graph`."
    ].join("\n");
  }

  bot.onText(/^\/(future|life_projection_graph)(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[2] || "").trim();

    if (/^(help|--help|-h)$/i.test(raw)) {
      return bot.sendMessage(chatId, renderHelp(), { parse_mode: "Markdown" });
    }

    try {
      const horizon = raw ? Number(raw) : 12;

      if (!Number.isInteger(horizon) || horizon < 1 || horizon > 60) {
        return bot.sendMessage(
          chatId,
          [
            "Usage: `/future [months]`",
            "Example: `/future 24`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const starting = getStartingAssets();
      const startingAssets = starting.total;
      const recurring = getRecurringMonthlyNet();
      const debtRows = getDebtRows();
      const monthlyExpenses = getMonthlyExpenses();

      const labels = monthLabels(horizon);

      const cashSeries = [startingAssets];
      for (let i = 1; i <= horizon; i++) {
        cashSeries.push(startingAssets + recurring.net * i);
      }

      const debtExtra = Math.max(0, recurring.net);
      const debtResult = simulateDebtSeries(debtRows, "avalanche", debtExtra, horizon);
      const debtSeries = debtResult.series;

      const netWorthSeries = cashSeries.map((cash, i) => {
        const debt = Number(debtSeries[i]) || 0;
        return cash - debt;
      });

      const debtFreeMarker = debtSeries.map(() => null);
      if (
        typeof debtResult.payoffMonths === "number" &&
        debtResult.payoffMonths >= 0 &&
        debtResult.payoffMonths < debtSeries.length
      ) {
        debtFreeMarker[debtResult.payoffMonths] = debtSeries[debtResult.payoffMonths];
      }

      const annualExpenses = monthlyExpenses * 12;
      const fiTarget = annualExpenses > 0 ? annualExpenses * 25 : 0;
      const fiMonths = simulateFIMonths(
        startingAssets,
        Math.max(0, recurring.net),
        7,
        fiTarget
      );

      const fiMarker = netWorthSeries.map(() => null);
      if (
        typeof fiMonths === "number" &&
        fiMonths >= 0 &&
        fiMonths < netWorthSeries.length
      ) {
        fiMarker[fiMonths] = netWorthSeries[fiMonths];
      }

      const minY = Math.min(...cashSeries, ...debtSeries, ...netWorthSeries);
      const maxY = Math.max(...cashSeries, ...debtSeries, ...netWorthSeries);

      let pad = (maxY - minY) * 0.12;
      if (!Number.isFinite(pad) || pad === 0) {
        pad = Math.max(50, Math.abs(maxY) * 0.05, Math.abs(minY) * 0.05);
      }

      const chartJSNodeCanvas = new ChartJSNodeCanvas({
        width: 1000,
        height: 600,
        backgroundColour: "#0f172a"
      });

      const maxTicks =
        horizon <= 12 ? horizon + 1 :
          horizon <= 24 ? 13 :
            10;

      const configuration = {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Assets Projection",
              data: cashSeries,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 3,
              fill: false
            },
            {
              label: "Debt Projection",
              data: debtSeries,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 3,
              fill: false,
              borderDash: [8, 6]
            },
            {
              label: "Net Worth Projection",
              data: netWorthSeries,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 3,
              fill: false,
              borderDash: [2, 4]
            },
            {
              label: "Debt-Free Point",
              data: debtFreeMarker,
              showLine: false,
              pointRadius: 8,
              pointHoverRadius: 10,
              pointBorderWidth: 2
            },
            {
              label: "FI Point",
              data: fiMarker,
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
                font: { size: 24 }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: "#ffffff",
                font: { size: 18 },
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
        filename: "future.png",
        contentType: "image/png"
      });

      let debtPayoffText;
      if (debtRows.length === 0) {
        debtPayoffText = "Already debt-free";
      } else if (debtResult.payoffMonths == null) {
        debtPayoffText = `Debt not paid off within ${horizon} months`;
      } else {
        debtPayoffText = `Debt-free by ${futureMonthLabel(debtResult.payoffMonths)}`;
      }

      let fiText;
      if (fiTarget <= 0 || fiMonths == null) {
        fiText = "FI not available";
      } else if (fiMonths > horizon) {
        fiText = `FI beyond ${horizon} months`;
      } else {
        fiText = `FI by ${futureMonthLabel(fiMonths)}`;
      }

      const finalNetWorth = netWorthSeries[netWorthSeries.length - 1];

      const summary = [
        "🔮 Financial Future",
        "",
        `Horizon: ${horizon} month(s)`,
        `Bank Now: ${formatMoney(starting.bank)}`,
        `Savings Now: ${formatMoney(starting.savings)}`,
        `Assets Now: ${formatMoney(startingAssets)}`,
        `Recurring Net: ${recurring.net >= 0 ? "+" : "-"}${formatMoney(Math.abs(recurring.net))} / month`,
        `${horizon}-Month Assets: ${formatMoney(cashSeries[cashSeries.length - 1])}`,
        `${horizon}-Month Net Worth: ${formatMoney(finalNetWorth)}`,
        debtPayoffText,
        fiText
      ].join("\n");

      return bot.sendMessage(chatId, summary);
    } catch (err) {
      console.error("future error:", err);
      return bot.sendMessage(chatId, "Error generating future graph.");
    }
  });
};

module.exports.help = {
  command: "future",
  aliases: ["life_projection_graph"],
  category: "Forecasting",
  summary: "Generate a forward-looking graph of assets, debt, and net worth over the next few months.",
  usage: [
    "/future",
    "/future <months>",
    "/life_projection_graph",
    "/life_projection_graph <months>"
  ],
  args: [
    { name: "<months>", description: "Optional horizon from 1 to 60. Defaults to 12." }
  ],
  examples: [
    "/future",
    "/future 24",
    "/life_projection_graph 18"
  ],
  notes: [
    "Starting assets include `assets:bank` and `assets:savings`."
  ]
};
