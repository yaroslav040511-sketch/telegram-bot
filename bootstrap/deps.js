// bootstrap/deps.js
const createLedgerService = require("../services/ledgerService");
const createFinanceEngine = require("../services/financeEngine");
const createRecurringProcessor = require("../services/recurringProcessor");

const reportService = require("../services/reportService");
const recurringService = require("../services/recurringService");

const simulateCashflow = require("../core/simulation");

const format = require("../utils/format");

module.exports = function createDeps(db, openai) {
  const ledgerService = createLedgerService(db);
  const financeEngine = createFinanceEngine(ledgerService);
  const recurringProcessor = createRecurringProcessor(db, ledgerService);

  const deps = {
    db,
    openai,

    ledgerService,
    financeEngine,
    reportService,
    recurringService,
    recurringProcessor,

    simulateCashflow,

    format
  };

  return Object.freeze(deps);
};
