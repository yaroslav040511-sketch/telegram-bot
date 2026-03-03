/* =====================================================
   DEPENDENCIES
===================================================== */

// External packages
const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const cron = require("node-cron");

// Database (centralized instance)
const db = require("./models/db");

// Core modules
const { simulateCashflow } = require("./core/simulation");

// Services (full service objects)
const reportService = require("./services/reportService");
const ledgerService = require("./services/ledgerService");
const recurringService = require("./services/recurringService");

// Handlers
const registerWhatIfHandler = require("./handlers/whatif");
const registerBalanceHandler = require("./handlers/balance");
const registerReportHandler = require("./handlers/report");
const registerIncomeHandler = require("./handlers/income");
const registerNetWorthHandler = require("./handlers/networth");
const registerSafetyHandler = require("./handlers/safety");
const registerLedgerHandler = require("./handlers/ledger");
const registerRecurringHandler = require("./handlers/recurring");


/* =====================================================
   ENVIRONMENT CHECKS
===================================================== */

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY not set");
  process.exit(1);
}


/* =====================================================
   INITIALIZATION
===================================================== */

// Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true
});

// OpenAI / OpenRouter client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1"
});


/* =====================================================
   REGISTER HANDLERS
===================================================== */

registerWhatIfHandler(bot, db, simulateCashflow);
registerBalanceHandler(bot, db);

registerReportHandler(bot, db, reportService);
registerIncomeHandler(bot, db, reportService);
registerNetWorthHandler(bot, db, reportService);
registerSafetyHandler(bot, db, reportService);

registerLedgerHandler(bot, db, ledgerService);
registerRecurringHandler(bot, db, recurringService);

// (other registerXYZHandler calls will go here later)
//

/* =========== ADD ================== */

bot.onText(/^\/add (.+) (\d+(\.\d+)?)$/, (msg, match) => {
  try {
    const description = match[1];
    const amount = parseFloat(match[2]);
    const date = new Date().toISOString().split("T")[0];

    const transaction = {
      date,
      description,
      postings: [
        { account: "expenses:food", amount: amount },
        { account: "assets:bank", amount: -amount }
      ]
    };

    ledgerService.addTransaction(transaction);

    bot.sendMessage(msg.chat.id, "Transaction added.");
    console.log("ADD handler triggered");

  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, "Failed to add transaction.");
  }
});

/* ==================================
 * UNDO
 * ================================== */

bot.onText(/\/undo/, (msg) => {
  try {
    const last = deleteLastTransaction();

    if (!last) {
      return bot.sendMessage(msg.chat.id, "Nothing to undo.");
    }

    return bot.sendMessage(
      msg.chat.id,
      `↩️ Undid: ${last.description} (${last.date})`
    );

  } catch (err) {
    console.error(err);
    return bot.sendMessage(msg.chat.id, "Error undoing transaction.");
  }
});

/* =====================================================
   SYSTEM PROMPT – STRICT DOUBLE ENTRY
===================================================== */

const systemPrompt = `
You are a finance assistant.

You have TWO MODES:

1) CHAT MODE
If the message is conversational, greeting, question, or not clearly a financial transaction:
Respond in normal plain text.

2) ACCOUNTING MODE
If the message clearly describes money being earned, spent, transferred, or paid:
Return ONLY valid JSON.
No markdown.
No explanation.
No extra text.

STRICT RULES:
- Only return JSON if it is DEFINITELY a financial transaction.
- If unsure, use CHAT MODE.
- Transactions MUST have at least two postings.
- Postings MUST balance to zero.

ACCOUNTING SIGN RULES:
- Assets increase = positive
- Assets decrease = negative
- Expenses increase = positive
- Income increase = negative
- Liability increase = negative
- Liability decrease = positive

DEFAULT ACCOUNTS:
- Bank: assets:bank
- Salary: income:salary
- Food: expenses:food
- Rent: expenses:rent

DATE RULE:
- Always use today's real date.
- Do NOT use example dates like 2023-10-04.
- The date must reflect the current real date.

FORMAT:

{
  "date": "YYYY-MM-DD",
  "description": "short description",
  "postings": [
    { "account": "assets:bank", "amount": 1000 },
    { "account": "income:salary", "amount": -1000 }
  ]
}
`;

/* =====================================================
   DAILY RECURRING SCHEDULER
===================================================== */

cron.schedule("0 0 * * *", () => {
  try {
    const count = processRecurring();
    console.log(`Processed ${count} recurring transactions.`);
  } catch (err) {
    console.error("Recurring processing error:", err);
  }
});

/* =====================================================
   COMMANDS
===================================================== */


/* ==================================================
 * RUNWAY
 =================================================== */

bot.onText(/\/runway/, (msg) => {
  try {
    const balances = getBalances();
    const totals = getLast30DayIncomeAndExpenses();

    // 1️⃣ Liquid assets only (bank accounts)
    let liquidAssets = 0;

    balances.forEach(b => {
      if (b.account.startsWith("assets:bank")) {
        liquidAssets += b.balance;
      }
    });

    let income = 0;
    let expenses = 0;

    totals.forEach(r => {
      if (r.type === "income") income += r.total;
      if (r.type === "expenses") expenses += r.total;
    });

    // income is negative in your system
    const operatingIncome = -income;
    const operatingExpenses = expenses;

    const trueBurn = operatingExpenses - operatingIncome;

    // ✅ PROFIT CASE
    if (trueBurn <= 0) {
      return bot.sendMessage(
        msg.chat.id,
        `🚀 You are profitable.\n\n` +
        `Income (30d): ${operatingIncome}\n` +
        `Expenses (30d): ${operatingExpenses}\n` +
        `Liquid Assets: ${liquidAssets}\n\n` +
        `Runway: ∞`
      );
    }

    // 🔥 Burn calculations
    const burnPerMonth = trueBurn;
    const burnPerDay = burnPerMonth / 30;

    const runwayMonths = liquidAssets / burnPerMonth;
    const runwayDays = liquidAssets / burnPerDay;

    // ⚠️ Smart warning system
    let warning = "";

    if (runwayMonths < 3) {
      warning = "\n⚠️ CRITICAL: Less than 3 months runway!";
    } else if (runwayMonths < 6) {
      warning = "\n⚠️ Warning: Less than 6 months runway.";
    }

    return bot.sendMessage(
      msg.chat.id,
      `🔥 Operating Burn: ${burnPerMonth.toFixed(2)}/month\n` +
      `💧 Daily Burn: ${burnPerDay.toFixed(2)}/day\n` +
      `🏦 Liquid Assets: ${liquidAssets}\n\n` +
      `⏳ Runway: ${runwayMonths.toFixed(1)} months (${runwayDays.toFixed(0)} days)` +
      warning
    );

  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, "Error calculating runway.");
  }
});

/* ================================================
 * FORCAST
   =============================================== */ 
 bot.onText(/^\/forecast$/, (msg) => {
  try {

    const checking = db.prepare(`
      SELECT id FROM accounts
      WHERE name = 'assets:bank'
    `).get();

    const balanceRow = db.prepare(`
      SELECT SUM(amount) as balance
      FROM postings
      WHERE account_id = ?
    `).get(checking.id);

    const currentBalance = Number(balanceRow?.balance) || 0;

    const result = simulateCashflow(db,currentBalance, checking.id, 30);

    let output = "📊 30-Day Forecast\n\n";
    output += `Starting Balance: ${currentBalance.toFixed(2)}\n\n`;

    for (const event of result.timeline) {
      output += `${event.date} | ${event.description} → ${event.balance.toFixed(2)}\n`;
    }

    return bot.sendMessage(msg.chat.id, output);

  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, "Forecast error.");
  }
});

/*  ===================================================
 *  HYBRID
    ================================================== */  

bot.onText(/\/hybrid/, async (msg) => {
  try {
    const balances = await getBalances();
    const recurring = await getRecurringTransactions();
    const totals = await getLast30DayIncomeAndExpenses();

    let liquidAssets = 0;

    for (const b of balances) {
      if (b.account.startsWith("assets:bank")) {
        liquidAssets += Number(b.balance) || 0;
      }
    }

    let income = 0;
    let expenses = 0;

    for (const r of totals) {
      if (r.type === "income") income += Number(r.total) || 0;
      if (r.type === "expenses") expenses += Number(r.total) || 0;
    }

    // Let ledger sign define polarity
    const recentBurn = expenses - income;

    let recurringImpact = 0;

    for (const r of recurring) {
      const multiplier = {
        daily: 30,
        weekly: 4.33,
        monthly: 1,
        yearly: 1 / 12
      }[r.frequency] || 1;

      const amount = (Number(r.amount) || 0) * multiplier;

      if (r.debit_account?.startsWith("assets:bank")) {
        recurringImpact += amount;
      }

      if (r.credit_account?.startsWith("assets:bank")) {
        recurringImpact -= amount;
      }
    }

    liquidAssets = Number(liquidAssets.toFixed(2));
    recurringImpact = Number(recurringImpact.toFixed(2));
    const projectedMonthlyNet = Number((recurringImpact - recentBurn).toFixed(2));

    if (projectedMonthlyNet >= 0) {
      return bot.sendMessage(
        msg.chat.id,
        `🔮 Hybrid Forecast\n\n` +
        `Recurring Net: ${recurringImpact}\n` +
        `Recent Burn: ${recentBurn.toFixed(2)}\n\n` +
        `📈 Projected Monthly Net: +${projectedMonthlyNet}\n` +
        `🏦 Liquid Assets: ${liquidAssets}\n\n` +
        `Runway: ∞`
      );
    }

    const burn = Math.abs(projectedMonthlyNet);
    const months = liquidAssets / burn;

    const depletionDate = new Date();
    depletionDate.setMonth(depletionDate.getMonth() + Math.floor(months));

    return bot.sendMessage(
      msg.chat.id,
      `🔮 Hybrid Forecast\n\n` +
      `Recurring Net: ${recurringImpact}\n` +
      `Recent Burn: ${recentBurn.toFixed(2)}\n\n` +
      `📉 Projected Monthly Net: -${burn.toFixed(2)}\n` +
      `🏦 Liquid Assets: ${liquidAssets}\n\n` +
      `⏳ ${months.toFixed(1)} months remaining\n` +
      `📅 ${depletionDate.toISOString().slice(0, 10)}`
    );

  } catch (err) {
    console.error("Hybrid error:", err);
    return bot.sendMessage(msg.chat.id, "Error calculating hybrid forecast.");
  }
});

/* =====================================================
   STRESS TEST
   Usage: /stress 100
===================================================== */

bot.onText(/\/stress (.+)/, async (msg, match) => {
  try {
    const stressAmount = Number(match[1]);

    if (isNaN(stressAmount) || stressAmount <= 0) {
      return bot.sendMessage(msg.chat.id, "Usage: /stress 100");
    }

    const balances = await getBalances();
    const recurring = await getRecurringTransactions();
    const totals = await getLast30DayIncomeAndExpenses();

    // 1️⃣ Liquid assets
    let liquidAssets = 0;

    for (const b of balances) {
      if (b.account.startsWith("assets:bank")) {
        liquidAssets += Number(b.balance) || 0;
      }
    }

    // 2️⃣ Recent burn
    let income = 0;
    let expenses = 0;

    for (const r of totals) {
      if (r.type === "income") income += Number(r.total) || 0;
      if (r.type === "expenses") expenses += Number(r.total) || 0;
    }

    const recentBurn = expenses - income;

    // 3️⃣ Recurring impact
    let recurringImpact = 0;

    for (const r of recurring) {
      const multiplier = {
        daily: 30,
        weekly: 4.33,
        monthly: 1,
        yearly: 1 / 12
      }[r.frequency] || 1;

      const amount = (Number(r.amount) || 0) * multiplier;

      if (r.debit_account?.startsWith("assets:bank")) {
        recurringImpact += amount;
      }

      if (r.credit_account?.startsWith("assets:bank")) {
        recurringImpact -= amount;
      }
    }

    // 4️⃣ Apply stress
    const stressedNet = recurringImpact - recentBurn - stressAmount;

    liquidAssets = Number(liquidAssets.toFixed(2));

    // PROFIT CASE
    if (stressedNet >= 0) {
      return bot.sendMessage(
        msg.chat.id,
        `🧪 Stress Test (+${stressAmount}/month)\n\n` +
        `Projected Monthly Net After Stress: +${stressedNet.toFixed(2)}\n` +
        `🏦 Liquid Assets: ${liquidAssets}\n\n` +
        `Runway: ∞`
      );
    }

    const burn = Math.abs(stressedNet);
    const months = liquidAssets / burn;

    const depletionDate = new Date();
    depletionDate.setMonth(depletionDate.getMonth() + Math.floor(months));

    return bot.sendMessage(
      msg.chat.id,
      `🧪 Stress Test (+${stressAmount}/month)\n\n` +
      `Projected Monthly Net After Stress: -${burn.toFixed(2)}\n` +
      `🏦 Liquid Assets: ${liquidAssets}\n\n` +
      `⏳ ${months.toFixed(1)} months remaining\n` +
      `📅 ${depletionDate.toISOString().slice(0, 10)}`
    );

  } catch (err) {
    console.error("Stress error:", err);
    return bot.sendMessage(msg.chat.id, "Error running stress test.");
  }
});

/* =====================================================
   RAISE SIMULATION
   Usage: /raise 500
===================================================== */

bot.onText(/\/raise (.+)/, async (msg, match) => {
  try {
    const raiseAmount = Number(match[1]);

    if (isNaN(raiseAmount) || raiseAmount <= 0) {
      return bot.sendMessage(msg.chat.id, "Usage: /raise 500");
    }

    const balances = await getBalances();
    const recurring = await getRecurringTransactions();
    const totals = await getLast30DayIncomeAndExpenses();

    let liquidAssets = 0;

    for (const b of balances) {
      if (b.account.startsWith("assets:bank")) {
        liquidAssets += Number(b.balance) || 0;
      }
    }

    let income = 0;
    let expenses = 0;

    for (const r of totals) {
      if (r.type === "income") income += Number(r.total) || 0;
      if (r.type === "expenses") expenses += Number(r.total) || 0;
    }

    const recentBurn = expenses - income;

    let recurringImpact = 0;

    for (const r of recurring) {
      const multiplier = {
        daily: 30,
        weekly: 4.33,
        monthly: 1,
        yearly: 1 / 12
      }[r.frequency] || 1;

      const amount = (Number(r.amount) || 0) * multiplier;

      if (r.debit_account?.startsWith("assets:bank")) {
        recurringImpact += amount;
      }

      if (r.credit_account?.startsWith("assets:bank")) {
        recurringImpact -= amount;
      }
    }

    const improvedNet = recurringImpact - recentBurn + raiseAmount;

    if (improvedNet >= 0) {
      return bot.sendMessage(
        msg.chat.id,
        `📈 Raise Simulation (+${raiseAmount}/month)\n\n` +
        `New Projected Monthly Net: +${improvedNet.toFixed(2)}\n` +
        `🏦 Liquid Assets: ${liquidAssets}\n\n` +
        `Runway: ∞`
      );
    }

    const burn = Math.abs(improvedNet);
    const months = liquidAssets / burn;

    const depletionDate = new Date();
    depletionDate.setMonth(depletionDate.getMonth() + Math.floor(months));

    return bot.sendMessage(
      msg.chat.id,
      `📈 Raise Simulation (+${raiseAmount}/month)\n\n` +
      `New Projected Monthly Net: -${burn.toFixed(2)}\n` +
      `🏦 Liquid Assets: ${liquidAssets}\n\n` +
      `⏳ ${months.toFixed(1)} months remaining\n` +
      `📅 ${depletionDate.toISOString().slice(0, 10)}`
    );

  } catch (err) {
    console.error("Raise error:", err);
    return bot.sendMessage(msg.chat.id, "Error running raise simulation.");
  }
});

/* =====================================================
   SHOCK SIMULATION (With Impact Delta)
   Usage: /shock 1200
===================================================== */

bot.onText(/\/shock (.+)/, async (msg, match) => {
  try {
    const shockAmount = Number(match[1]);

    if (isNaN(shockAmount) || shockAmount <= 0) {
      return bot.sendMessage(msg.chat.id, "Usage: /shock 1200");
    }

    const balances = await getBalances();
    const totals = await getLast30DayIncomeAndExpenses();

    let liquidAssets = 0;

    for (const b of balances) {
      if (b.account.startsWith("assets:bank")) {
        liquidAssets += Number(b.balance) || 0;
      }
    }

    let income = 0;
    let expenses = 0;

    for (const r of totals) {
      if (r.type === "income") income += Number(r.total) || 0;
      if (r.type === "expenses") expenses += Number(r.total) || 0;
    }

    const monthlyBurn = expenses - income;

    // BEFORE runway
    let beforeRunway = Infinity;

    if (monthlyBurn > 0) {
      beforeRunway = liquidAssets / monthlyBurn;
    }

    // Apply shock
    const newLiquidAssets = liquidAssets - shockAmount;

    if (newLiquidAssets <= 0) {
      return bot.sendMessage(
        msg.chat.id,
        `💥 Shock Event (-${shockAmount})\n\n` +
        `Liquidity exhausted immediately.\n` +
        `Impact: -${beforeRunway.toFixed(1)} months of runway`
      );
    }

    // AFTER runway
    let afterRunway = Infinity;

    if (monthlyBurn > 0) {
      afterRunway = newLiquidAssets / monthlyBurn;
    }

    const impactMonths =
      beforeRunway === Infinity
        ? 0
        : beforeRunway - afterRunway;

    if (monthlyBurn <= 0) {
      return bot.sendMessage(
        msg.chat.id,
        `💥 Shock Event (-${shockAmount})\n\n` +
        `Before Shock: Profitable (∞ runway)\n` +
        `After Shock: Profitable (∞ runway)\n\n` +
        `🏦 New Liquid Assets: ${newLiquidAssets.toFixed(2)}`
      );
    }

    return bot.sendMessage(
      msg.chat.id,
      `💥 Shock Event (-${shockAmount})\n\n` +
      `Before Shock:\n` +
      `  Liquid Assets: ${liquidAssets.toFixed(2)}\n` +
      `  Runway: ${beforeRunway.toFixed(1)} months\n\n` +
      `After Shock:\n` +
      `  Liquid Assets: ${newLiquidAssets.toFixed(2)}\n` +
      `  Runway: ${afterRunway.toFixed(1)} months\n\n` +
      `📉 Impact: -${impactMonths.toFixed(1)} months`
    );

  } catch (err) {
    console.error("Shock error:", err);
    return bot.sendMessage(msg.chat.id, "Error running shock simulation.");
  }
});

/* ==================================================
 * STATUS
   ================================================== */

bot.onText(/^\/status(@\w+)?$/, async (msg) => {
  try {
    const balances = await getBalances();
    const totals = await getLast30DayIncomeAndExpenses();

    let liquidAssets = 0;

    for (const b of balances) {
      if (b.account.startsWith("assets:bank")) {
        liquidAssets += Number(b.balance) || 0;
      }
    }

    let income = 0;
    let expenses = 0;

    for (const r of totals) {
      if (r.type === "income") income += Number(r.total) || 0;
      if (r.type === "expenses") expenses += Number(r.total) || 0;
    }

    const monthlyNet = income - expenses;

    let runway = Infinity;

    if (monthlyNet < 0) {
      runway = liquidAssets / Math.abs(monthlyNet);
    }

    const runwayText =
      runway === Infinity
        ? "∞ (Profitable)"
        : `${runway.toFixed(1)} months`;

    return bot.sendMessage(
      msg.chat.id,
      `📊 Financial Status\n\n` +
      `🏦 Liquid Assets: ${liquidAssets.toFixed(2)}\n` +
      `📈 Monthly Income: ${income.toFixed(2)}\n` +
      `📉 Monthly Expenses: ${expenses.toFixed(2)}\n` +
      `💰 Monthly Net: ${monthlyNet.toFixed(2)}\n\n` +
      `⏳ Runway: ${runwayText}`
    );

  } catch (err) {
    console.error("Status error:", err);
    return bot.sendMessage(msg.chat.id, "Error retrieving status.");
  }	  
});


/* ======================================
 * BUFFER
 * ====================================== */
bot.onText(/^\/buffer$/, (msg) => {
  try {

    const checking = db.prepare(`
      SELECT id FROM accounts
      WHERE name = 'assets:bank'
    `).get();

    const balanceRow = db.prepare(`
      SELECT SUM(amount) as balance
      FROM postings
      WHERE account_id = ?
    `).get(checking.id);

    const currentBalance = Number(balanceRow?.balance) || 0;

    const result = simulateCashflow(currentBalance, checking.id, 30);

    let requiredBuffer = 0;

    if (result.lowestBalance < 0) {
      requiredBuffer = Math.abs(result.lowestBalance);
    }

    let output = "🧱 Recommended Buffer\n\n";
    output += `Lowest projected balance: ${result.lowestBalance.toFixed(2)}\n`;
    output += `Minimum safe buffer: ${requiredBuffer.toFixed(2)}\n`;

    return bot.sendMessage(msg.chat.id, output);

  } catch (err) {
    console.error(err);
    bot.sendMessage(msg.chat.id, "Buffer error.");
  }
});

/* ==================================================
 * WHATIF (Enhanced)
 * ================================================== */

// Fallback if no amount provided
bot.onText(/^\/whatif$/, (msg) => {
  return bot.sendMessage(msg.chat.id, "Usage: /whatif 50\nExample: /whatif 120.75");
});

bot.onText(/^\/whatif (-?\d+(\.\d+)?)/, (msg, match) => {
  try {

    const amount = Number(match[1]);

    const checking = db.prepare(`
      SELECT id FROM accounts
      WHERE name = 'assets:bank'
    `).get();

    if (!checking) {
      return bot.sendMessage(msg.chat.id, "Checking account not found.");
    }

    const balanceRow = db.prepare(`
      SELECT SUM(amount) as balance
      FROM postings
      WHERE account_id = ?
    `).get(checking.id);

    const currentBalance = Number(balanceRow?.balance) || 0;

    // Spending reduces balance, income increases it
    const adjustedBalance = currentBalance - amount;

    const result = simulateCashflow(adjustedBalance, checking.id, 30);

    const lowest = result?.lowestBalance ?? adjustedBalance;
    const delta = lowest - currentBalance;

    let output = `🧪 What If Scenario\n\n`;

    if (amount >= 0) {
      output += `Simulated expense: $${amount.toLocaleString()}\n`;
    } else {
      output += `Simulated income: $${Math.abs(amount).toLocaleString()}\n`;
    }

    output += `New starting balance: $${adjustedBalance.toLocaleString()}\n`;
    output += `Projected 30-Day Minimum: $${lowest.toLocaleString()}\n\n`;

    if (lowest < 0) {
      output += "⚠️ This would cause an overdraft within 30 days.";
    } else {
      output += "✅ No overdraft risk in the next 30 days.";
    }

    return bot.sendMessage(msg.chat.id, output);

  } catch (err) {
    console.error("What-if error:", err);
    bot.sendMessage(msg.chat.id, "What-if error.");
  }
});

/* ==================================================
 * FORECAST GRAPH (Dark Mode + Risk Detection)
 * ================================================== */

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

bot.onText(/^\/forecastgraph$/, async (msg) => {
  try {

    const checking = db.prepare(`
      SELECT id FROM accounts
      WHERE name = 'assets:bank'
    `).get();

    if (!checking) {
      return bot.sendMessage(msg.chat.id, "Checking account not found.");
    }

    const balanceRow = db.prepare(`
      SELECT SUM(amount) as balance
      FROM postings
      WHERE account_id = ?
    `).get(checking.id);

    const currentBalance = Number(balanceRow?.balance) || 0;

    const result = simulateCashflow(currentBalance, checking.id, 30);

    const labels = ["Today"];
    const balances = [currentBalance];

    if (result?.timeline?.length) {
      for (const event of result.timeline) {
        labels.push(event.date);
        balances.push(event.balance);
      }
    }

    const minBalance = Math.min(...balances);
    const hasNegative = minBalance < 0;

    const width = 1000;
    const height = 600;

    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: '#0f172a' // dark slate background
    });

    const configuration = {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Projected Balance',
          data: balances,
          borderWidth: 4,
          tension: 0.25,
          pointRadius: 4,
          fill: true,
          borderColor: hasNegative ? '#ef4444' : '#22c55e',
          backgroundColor: hasNegative
            ? 'rgba(239, 68, 68, 0.15)'
            : 'rgba(34, 197, 94, 0.2)'
        }]
      },
      options: {
        responsive: false,
        layout: {
          padding: 40
        },
        plugins: {
          legend: {
            labels: {
              color: '#ffffff',
              font: {
                size: 24
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#ffffff',
              font: { size: 20 },
              maxTicksLimit: 8
            },
            grid: {
              color: 'rgba(255,255,255,0.08)'
            }
          },
          y: {
            ticks: {
              color: '#ffffff',
              font: { size: 22 },
              callback: value =>
                '$' + Number(value).toLocaleString()
            },
            grid: {
              color: ctx =>
                ctx.tick.value === 0
                  ? 'rgba(255,255,255,0.35)'
                  : 'rgba(255,255,255,0.08)'
            }
          }
        }
      }
    };

    const image = await chartJSNodeCanvas.renderToBuffer(configuration);

    // Send directly from memory (no temp file, no warning)
    await bot.sendPhoto(msg.chat.id, image, {
      filename: 'forecast.png',
      contentType: 'image/png'
    });

    // Send financial summary
    let summary = `Current Balance: $${currentBalance.toLocaleString()}\n`;
    summary += `Projected 30-Day Minimum: $${minBalance.toLocaleString()}\n\n`;

    if (hasNegative) {
      summary += "⚠️ Overdraft risk detected in the next 30 days.";
    } else {
      summary += "✅ No overdraft risk in the next 30 days.";
    }

    await bot.sendMessage(msg.chat.id, summary);

  } catch (err) {
    console.error("Forecast graph error:", err);
    bot.sendMessage(msg.chat.id, "Error generating forecast graph.");
  }
});

/* ==================================================
 *  AI MESSAGE HANDLER (CHAT + ACCOUNTING MODE)
 * ================================================== */

bot.on("message", async (msg) => {
  try {
    if (!msg.text) return;

    // Ignore slash commands (they are handled above)
    if (msg.text.startsWith("/")) return;

    const completion = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini", // change if needed
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: msg.text }
      ],
      temperature: 0.2
    });

    const reply = completion.choices[0].message.content.trim();

    // Try to parse JSON (Accounting Mode)
    try {
      const parsed = JSON.parse(reply);

      if (parsed.postings && Array.isArray(parsed.postings)) {
        addTransaction(parsed);
        return bot.sendMessage(
          msg.chat.id,
          `✅ Transaction recorded:\n${parsed.description}`
        );
      }

    } catch (jsonErr) {
      // Not JSON → Chat mode
    }

    // Chat mode fallback
    return bot.sendMessage(msg.chat.id, reply);

  } catch (err) {
    console.error("AI error:", err);
    return bot.sendMessage(msg.chat.id, "AI error.");
  }
});
