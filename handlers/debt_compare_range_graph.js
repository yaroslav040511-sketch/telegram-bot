// handlers/debt_compare_range_graph.js
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");

module.exports = function registerDebtCompareRangeGraphHandler(bot, deps) {
  const { db, format, debt } = deps;
  const { formatMoney } = format;
  const { getDebtRows, runDebtSimulation } = debt;

  function renderHelp() {
    return [
      "*\\/debt_compare_range_graph*",
      "Compare snowball versus avalanche across a range of extra monthly payment amounts and graph the payoff time.",
      "",
      "*Usage*",
      "- `/debt_compare_range_graph <start> <end> <step>`",
      "",
      "*Arguments*",
      "- `<start>` — Starting extra monthly payment. Must be zero or greater.",
      "- `<end>` — Ending extra monthly payment. Must be greater than or equal to start.",
      "- `<step>` — Step size between values. Must be greater than 0.",
      "",
      "*Examples*",
      "- `/debt_compare_range_graph 100 500 100`",
      "- `/debt_compare_range_graph 50 300 50`",
      "",
      "*Notes*",
      "- Uses your current debts table.",
      "- Graph shows months to payoff for both strategies at each extra-payment level."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/debt_compare_range_graph(?:@\w+)?(?:\s+(.*))?$/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const parsed = raw.match(
        /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/
      );

      if (!parsed) {
        return bot.sendMessage(
          chatId,
          [
            "Missing or invalid arguments for `/debt_compare_range_graph`.",
            "",
            "Usage:",
            "`/debt_compare_range_graph <start> <end> <step>`",
            "",
            "Example:",
            "`/debt_compare_range_graph 100 500 100`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const start = Number(parsed[1]);
      const end = Number(parsed[2]);
      const step = Number(parsed[3]);

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
          [
            "Arguments must satisfy: start >= 0, end >= start, step > 0.",
            "",
            "Usage:",
            "`/debt_compare_range_graph <start> <end> <step>`",
            "",
            "Example:",
            "`/debt_compare_range_graph 100 500 100`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const rows = getDebtRows(db);

      if (!rows.length) {
        return bot.sendMessage(chatId, "No debts recorded.");
      }

      const extras = [];
      const snowballMonths = [];
      const avalancheMonths = [];
      const summaries = [];

      for (let extra = start; extra <= end + 0.0000001; extra += step) {
        const normalizedExtra = Number(extra.toFixed(10));

        const snow = runDebtSimulation(rows, "snowball", normalizedExtra);
        const ava = runDebtSimulation(rows, "avalanche", normalizedExtra);

        extras.push(normalizedExtra);
        snowballMonths.push(snow.months);
        avalancheMonths.push(ava.months);

        let note = "same";
        if (
          snow.months != null && snow.interest != null &&
          ava.months != null && ava.interest != null
        ) {
          if (ava.interest + 0.005 < snow.interest) {
            note = `avalanche saves ${formatMoney(snow.interest - ava.interest)}`;
          } else if (snow.interest + 0.005 < ava.interest) {
            note = `snowball saves ${formatMoney(ava.interest - snow.interest)}`;
          }
        }

        const pointCount = Math.floor((end - start) / step) + 1;

        if (pointCount < 2) {
          return bot.sendMessage(
            chatId,
            [
              "Range graph needs at least two tested payment values.",
              "",
              "Try:",
              "`/debt_compare_range_graph 250 350 50`",
              "or",
              "`/debt_compare 300`"
            ].join("\n"),
            { parse_mode: "Markdown" }
          );
        }

        summaries.push({
          extra: normalizedExtra,
          snow,
          ava,
          note
        });
      }

      const chartJSNodeCanvas = new ChartJSNodeCanvas({
        width: 1000,
        height: 600,
        backgroundColour: "#0f172a"
      });

      const configuration = {
        type: "line",
        data: {
          labels: extras.map((x) => `$${x.toFixed(0)}`),
          datasets: [
            {
              label: "Snowball Months",
              data: snowballMonths,
              borderWidth: 4,
              tension: 0.25,
              pointRadius: 3,
              fill: false,
              borderDash: [8, 6]
            },
            {
              label: "Avalanche Months",
              data: avalancheMonths,
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
                callback: (value) => `${Number(value)}m`
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
        filename: "debt_compare_range_graph.png",
        contentType: "image/png"
      });

      let summary = "💳 Debt Compare Range Graph\n\n";
      summary += `Range: ${formatMoney(start)} → ${formatMoney(end)} step ${formatMoney(step)}\n\n`;

      const firstValid = summaries.find(
        (s) =>
          s.snow.months != null &&
          s.snow.interest != null &&
          s.ava.months != null &&
          s.ava.interest != null
      );

      const lastValid = [...summaries].reverse().find(
        (s) =>
          s.snow.months != null &&
          s.snow.interest != null &&
          s.ava.months != null &&
          s.ava.interest != null
      );

      if (firstValid) {
        summary += `At ${formatMoney(firstValid.extra)}: Snowball ${firstValid.snow.months}m, Avalanche ${firstValid.ava.months}m\n`;
      }

      if (lastValid && lastValid !== firstValid) {
        summary += `At ${formatMoney(lastValid.extra)}: Snowball ${lastValid.snow.months}m, Avalanche ${lastValid.ava.months}m\n`;
      }

      const bestInterestPoint = summaries
        .filter(
          (s) =>
            s.snow.months != null &&
            s.snow.interest != null &&
            s.ava.months != null &&
            s.ava.interest != null
        )
        .reduce((best, current) => {
          const delta = current.snow.interest - current.ava.interest;
          if (!best || delta > best.delta) {
            return { extra: current.extra, delta };
          }
          return best;
        }, null);

      if (bestInterestPoint && bestInterestPoint.delta > 0) {
        summary += `\nBest avalanche interest edge in this range: ${formatMoney(bestInterestPoint.delta)} at ${formatMoney(bestInterestPoint.extra)} extra.`;
      }

      return bot.sendMessage(chatId, summary);
    } catch (err) {
      console.error("debt_compare_range_graph error:", err);
      return bot.sendMessage(chatId, "Error generating debt compare range graph.");
    }
  });
};

module.exports.help = {
  command: "debt_compare_range_graph",
  category: "Debt",
  summary: "Compare snowball versus avalanche across a range of extra monthly payment amounts and graph the payoff time.",
  usage: [
    "/debt_compare_range_graph <start> <end> <step>"
  ],
  args: [
    { name: "<start>", description: "Starting extra monthly payment. Must be zero or greater." },
    { name: "<end>", description: "Ending extra monthly payment. Must be greater than or equal to start." },
    { name: "<step>", description: "Step size between values. Must be greater than 0." }
  ],
  examples: [
    "/debt_compare_range_graph 100 500 100",
    "/debt_compare_range_graph 50 300 50"
  ],
  notes: [
    "Uses your current debts table.",
    "Graph shows months to payoff for both strategies at each extra-payment level."
  ]
};
