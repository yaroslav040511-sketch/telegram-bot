// index.js
// require("dotenv").config(); // optional: only if you use a .env file

const db = require("./models/db");

const createBot = require("./bootstrap/bot");
const createOpenAIClient = require("./bootstrap/openai");
const createDeps = require("./bootstrap/deps");
const registerCronJobs = require("./bootstrap/cron");

const registerAllHandlers = require("./handlers");

/* =====================================================
   ENV CHECKS
===================================================== */

function requireEnv(key) {
  if (!process.env[key]) {
    console.error(`${key} not set`);
    process.exit(1);
  }
}

requireEnv("TELEGRAM_BOT_TOKEN");
requireEnv("OPENAI_API_KEY");

/* =====================================================
   BOOTSTRAP
===================================================== */

const bot = createBot();
const openai = createOpenAIClient();

// deps is the single source of truth for services
const deps = createDeps(db, openai);

/* =====================================================
   STARTUP
===================================================== */

registerAllHandlers(bot, deps);
registerCronJobs({ recurringProcessor: deps.recurringProcessor });

console.log("Bot started.");
