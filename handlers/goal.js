// handlers/goal.js
module.exports = function registerGoalHandler(bot, deps) {
  const { db, ledgerService, format, finance } = deps;
  const { formatMoney, codeBlock } = format;
  const {
    futureMonthLabel,
    getStartingAssets,
    getRecurringMonthlyNet
  } = finance;

  function renderHelp() {
    return [
      "*\\/goal*",
      "Estimate whether a purchase or savings goal is already funded, and if not, when it may become affordable.",
      "",
      "*Usage*",
      "- `/goal <name> <amount>`",
      "",
      "*Arguments*",
      "- `<name>` — Goal name, optionally quoted if it contains spaces.",
      "- `<amount>` — Goal amount. Must be greater than 0.",
      "",
      "*Examples*",
      "- `/goal laptop 1200`",
      "- `/goal \"new couch\" 1800`",
      "- `/goal vacation 2500`",
      "",
      "*Notes*",
      "- Starting assets include `assets:bank` and `assets:savings`.",
      "- ETA uses recurring monthly surplus only."
    ].join("\n");
  }

  function sendHelp(chatId) {
    return bot.sendMessage(chatId, renderHelp(), {
      parse_mode: "Markdown"
    });
  }

  bot.onText(/^\/goal(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || /^(help|--help|-h)$/i.test(raw)) {
      return sendHelp(chatId);
    }

    try {
      const parsed = raw.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)$/);

      if (!parsed) {
        return bot.sendMessage(
          chatId,
          [
            "Missing or invalid arguments for `/goal`.",
            "",
            "Usage:",
            "`/goal <name> <amount>`",
            "",
            "Examples:",
            "`/goal laptop 1200`",
            "`/goal \"new couch\" 1800`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const name = String(parsed[1] || "")
        .trim()
        .replace(/^["']|["']$/g, "");
      const target = Number(parsed[2]);

      if (!name) {
        return bot.sendMessage(
          chatId,
          [
            "Goal name is required.",
            "",
            "Usage:",
            "`/goal <name> <amount>`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      if (!Number.isFinite(target) || target <= 0) {
        return bot.sendMessage(
          chatId,
          [
            "Goal amount must be greater than 0.",
            "",
            "Usage:",
            "`/goal <name> <amount>`",
            "",
            "Example:",
            "`/goal laptop 1200`"
          ].join("\n"),
          { parse_mode: "Markdown" }
        );
      }

      const starting = getStartingAssets(ledgerService);
      const assets = starting.total;
      const recurring = getRecurringMonthlyNet(db);
      const recurringNet = recurring.net;

      const alreadyCovered = assets >= target;
      const gap = Math.max(0, target - assets);

      let etaText = "already funded";
      if (!alreadyCovered) {
        if (recurringNet > 0) {
          const months = Math.ceil(gap / recurringNet);
          etaText = `${months} month(s) (${futureMonthLabel(months)})`;
        } else {
          etaText = "unavailable";
        }
      }

      let verdict;
      if (alreadyCovered) {
        verdict = "✅ You can already afford this goal.";
      } else if (recurringNet > 0) {
        verdict = "🟡 Goal is reachable with your current recurring surplus.";
      } else {
        verdict = "⚠️ Goal is not currently reachable from recurring surplus.";
      }

      const out = [
        "🎯 *Goal Projection*",
        "",
        codeBlock([
          `Goal             ${name}`,
          `Target Amount    ${formatMoney(target)}`,
          `Bank Balance     ${formatMoney(starting.bank)}`,
          `Savings Balance  ${formatMoney(starting.savings)}`,
          `Assets on Hand   ${formatMoney(assets)}`,
          `Recurring Net    ${recurringNet >= 0 ? "+" : "-"}${formatMoney(Math.abs(recurringNet))}/mo`,
          `Gap              ${formatMoney(gap)}`,
          `ETA              ${etaText}`
        ].join("\n")),
        verdict
      ].join("\n");

      return bot.sendMessage(chatId, out, {
        parse_mode: "Markdown"
      });
    } catch (err) {
      console.error("goal error:", err);
      return bot.sendMessage(chatId, "Error calculating goal.");
    }
  });
};

module.exports.help = {
  command: "goal",
  category: "Forecasting",
  summary: "Estimate whether a purchase or savings goal is already funded, and if not, when it may become affordable.",
  usage: [
    "/goal <name> <amount>"
  ],
  args: [
    { name: "<name>", description: "Goal name, optionally quoted if it contains spaces." },
    { name: "<amount>", description: "Goal amount. Must be greater than 0." }
  ],
  examples: [
    "/goal laptop 1200",
    "/goal \"new couch\" 1800",
    "/goal vacation 2500"
  ],
  notes: [
    "Starting assets include `assets:bank` and `assets:savings`.",
    "ETA uses recurring monthly surplus only."
  ]
};
