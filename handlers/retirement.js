// handlers/retirement.js
const { yearsMonths } = require("../utils/dates");

module.exports = function registerRetirementHandler(bot, deps) {
  const { db, ledgerService, format, finance } = deps;
  const { formatMoney, codeBlock } = format;
  const {
    getStartingAssets,
    getRecurringMonthlyNet
  } = finance;

  function getStartingInvestableBalance() {
    return getStartingAssets(ledgerService);
  }

  function simulate(startBalance, monthlySave, annualReturn, target) {
    const monthlyRate = annualReturn / 100 / 12;

    let balance = startBalance;
    let months = 0;

    while (balance < target && months < 1200) {
      balance = balance * (1 + monthlyRate) + monthlySave;
      months += 1;
    }

    return months;
  }

  function targetDate(months) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);

    const month = d.toLocaleString("en-US", { month: "long" });
    const year = d.getFullYear();

    return `${month} ${year}`;
  }

  function sendMarkdown(chatId, text) {
    return bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  function isHelpArg(raw) {
    return /^(help|--help|-h)$/i.test(String(raw || "").trim());
  }

  function renderRetirementHelp() {
    return [
      "*\\/retirement*",
      "Project how long it will take to reach an investment target using a manual monthly contribution.",
      "",
      "*Usage*",
      "- `/retirement <monthlySave> <annualReturn> <target>`",
      "",
      "*Arguments*",
      "- `<monthlySave>` — Monthly investment amount. Must be greater than 0.",
      "- `<annualReturn>` — Expected annual return percentage, such as `7`.",
      "- `<target>` — Goal amount you want to reach.",
      "",
      "*Examples*",
      "- `/retirement 500 7 500000`",
      "- `/retirement 1200 8 1000000`",
      "",
      "*Notes*",
      "- Starting balance includes `assets:bank` and `assets:savings`.",
      "- Projection uses monthly compounding."
    ].join("\n");
  }

  function renderRetirementAutoHelp() {
    return [
      "*\\/retirement_auto*",
      "Project how long it will take to reach an investment target using your recurring monthly surplus automatically.",
      "",
      "*Usage*",
      "- `/retirement_auto <annualReturn> <target>`",
      "",
      "*Arguments*",
      "- `<annualReturn>` — Expected annual return percentage, such as `7`.",
      "- `<target>` — Goal amount you want to reach.",
      "",
      "*Examples*",
      "- `/retirement_auto 7 500000`",
      "- `/retirement_auto 8 1000000`",
      "",
      "*Notes*",
      "- Starting balance includes `assets:bank` and `assets:savings`.",
      "- Monthly surplus is derived from recurring cashflow."
    ].join("\n");
  }

  bot.onText(/^\/retirement(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || isHelpArg(raw)) {
      return sendMarkdown(chatId, renderRetirementHelp());
    }

    try {
      const parsed = raw.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);

      if (!parsed) {
        return sendMarkdown(
          chatId,
          [
            "Missing or invalid arguments for `/retirement`.",
            "",
            "Usage:",
            "`/retirement <monthlySave> <annualReturn> <target>`",
            "",
            "Example:",
            "`/retirement 500 7 500000`"
          ].join("\n")
        );
      }

      const monthlySave = Number(parsed[1]);
      const annualReturn = Number(parsed[2]);
      const target = Number(parsed[3]);

      if (!Number.isFinite(monthlySave) || monthlySave <= 0) {
        return sendMarkdown(
          chatId,
          [
            "Monthly savings must be greater than 0.",
            "",
            "Usage:",
            "`/retirement <monthlySave> <annualReturn> <target>`"
          ].join("\n")
        );
      }

      if (!Number.isFinite(annualReturn) || annualReturn < 0) {
        return sendMarkdown(
          chatId,
          [
            "Annual return must be zero or greater.",
            "",
            "Usage:",
            "`/retirement <monthlySave> <annualReturn> <target>`"
          ].join("\n")
        );
      }

      if (!Number.isFinite(target) || target <= 0) {
        return sendMarkdown(
          chatId,
          [
            "Target must be greater than 0.",
            "",
            "Usage:",
            "`/retirement <monthlySave> <annualReturn> <target>`"
          ].join("\n")
        );
      }

      const starting = getStartingInvestableBalance();
      const startBalance = starting.total;

      if (startBalance >= target) {
        return sendMarkdown(
          chatId,
          [
            "🏖️ *Retirement Projection*",
            "",
            codeBlock([
              `Bank Balance       ${formatMoney(starting.bank)}`,
              `Savings Balance    ${formatMoney(starting.savings)}`,
              `Starting Total     ${formatMoney(startBalance)}`,
              `Monthly Investment ${formatMoney(monthlySave)}`,
              `Annual Return      ${annualReturn}%`,
              `Target             ${formatMoney(target)}`,
              `Time to Goal       0y 0m`,
              `Target Date        already reached`
            ].join("\n"))
          ].join("\n")
        );
      }

      const months = simulate(startBalance, monthlySave, annualReturn, target);
      const ym = yearsMonths(months);
      const date = targetDate(months);

      return sendMarkdown(
        chatId,
        [
          "🏖️ *Retirement Projection*",
          "",
          codeBlock([
            `Bank Balance       ${formatMoney(starting.bank)}`,
            `Savings Balance    ${formatMoney(starting.savings)}`,
            `Starting Total     ${formatMoney(startBalance)}`,
            `Monthly Investment ${formatMoney(monthlySave)}`,
            `Annual Return      ${annualReturn}%`,
            `Target             ${formatMoney(target)}`,
            `Time to Goal       ${ym.years}y ${ym.months}m`,
            `Target Date        ${date}`
          ].join("\n"))
        ].join("\n")
      );
    } catch (err) {
      console.error("retirement error:", err);
      return bot.sendMessage(chatId, "Error calculating retirement.");
    }
  });

  bot.onText(/^\/retirement_auto(?:@\w+)?(?:\s+(.*))?$/i, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = String(match?.[1] || "").trim();

    if (!raw || isHelpArg(raw)) {
      return sendMarkdown(chatId, renderRetirementAutoHelp());
    }

    try {
      const parsed = raw.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);

      if (!parsed) {
        return sendMarkdown(
          chatId,
          [
            "Missing or invalid arguments for `/retirement_auto`.",
            "",
            "Usage:",
            "`/retirement_auto <annualReturn> <target>`",
            "",
            "Example:",
            "`/retirement_auto 7 500000`"
          ].join("\n")
        );
      }

      const annualReturn = Number(parsed[1]);
      const target = Number(parsed[2]);

      if (!Number.isFinite(annualReturn) || annualReturn < 0) {
        return sendMarkdown(
          chatId,
          [
            "Annual return must be zero or greater.",
            "",
            "Usage:",
            "`/retirement_auto <annualReturn> <target>`"
          ].join("\n")
        );
      }

      if (!Number.isFinite(target) || target <= 0) {
        return sendMarkdown(
          chatId,
          [
            "Target must be greater than 0.",
            "",
            "Usage:",
            "`/retirement_auto <annualReturn> <target>`"
          ].join("\n")
        );
      }

      const starting = getStartingInvestableBalance();
      const startBalance = starting.total;
      const recurring = getRecurringMonthlyNet(db);
      const monthlySave = recurring.net;

      if (monthlySave <= 0) {
        return sendMarkdown(
          chatId,
          [
            "Recurring surplus is not positive, so auto-investing cannot be projected.",
            "",
            "Usage:",
            "`/retirement_auto <annualReturn> <target>`"
          ].join("\n")
        );
      }

      if (startBalance >= target) {
        return sendMarkdown(
          chatId,
          [
            "🏖️ *Retirement Projection (Auto)*",
            "",
            codeBlock([
              `Bank Balance       ${formatMoney(starting.bank)}`,
              `Savings Balance    ${formatMoney(starting.savings)}`,
              `Starting Total     ${formatMoney(startBalance)}`,
              `Monthly Surplus    ${formatMoney(monthlySave)}`,
              `Annual Return      ${annualReturn}%`,
              `Target             ${formatMoney(target)}`,
              `Time to Goal       0y 0m`,
              `Target Date        already reached`
            ].join("\n"))
          ].join("\n")
        );
      }

      const months = simulate(startBalance, monthlySave, annualReturn, target);
      const ym = yearsMonths(months);
      const date = targetDate(months);

      return sendMarkdown(
        chatId,
        [
          "🏖️ *Retirement Projection (Auto)*",
          "",
          codeBlock([
            `Bank Balance       ${formatMoney(starting.bank)}`,
            `Savings Balance    ${formatMoney(starting.savings)}`,
            `Starting Total     ${formatMoney(startBalance)}`,
            `Monthly Surplus    ${formatMoney(monthlySave)}`,
            `Annual Return      ${annualReturn}%`,
            `Target             ${formatMoney(target)}`,
            `Time to Goal       ${ym.years}y ${ym.months}m`,
            `Target Date        ${date}`
          ].join("\n"))
        ].join("\n")
      );
    } catch (err) {
      console.error("retirement_auto error:", err);
      return bot.sendMessage(chatId, "Error calculating retirement_auto.");
    }
  });
};

module.exports.helpEntries = [
  {
    command: "retirement",
    category: "Forecasting",
    summary: "Project how long it will take to reach an investment target using a manual monthly contribution.",
    usage: [
      "/retirement <monthlySave> <annualReturn> <target>"
    ],
    args: [
      { name: "<monthlySave>", description: "Monthly investment amount. Must be greater than 0." },
      { name: "<annualReturn>", description: "Expected annual return percentage, such as `7`." },
      { name: "<target>", description: "Goal amount you want to reach." }
    ],
    examples: [
      "/retirement 500 7 500000",
      "/retirement 1200 8 1000000"
    ],
    notes: [
      "Starting balance includes `assets:bank` and `assets:savings`.",
      "Projection uses monthly compounding."
    ]
  },
  {
    command: "retirement_auto",
    category: "Forecasting",
    summary: "Project how long it will take to reach an investment target using your recurring monthly surplus automatically.",
    usage: [
      "/retirement_auto <annualReturn> <target>"
    ],
    args: [
      { name: "<annualReturn>", description: "Expected annual return percentage, such as `7`." },
      { name: "<target>", description: "Goal amount you want to reach." }
    ],
    examples: [
      "/retirement_auto 7 500000",
      "/retirement_auto 8 1000000"
    ],
    notes: [
      "Starting balance includes `assets:bank` and `assets:savings`.",
      "Monthly surplus is derived from recurring cashflow."
    ]
  }
];
