// data/help_registry.js
module.exports = {
  add: {
    category: "Basic Accounting",
    description: "Add an expense.",
    usage: "/add <description> <amount>",
    examples: [
      "/add groceries 25",
      "/add coffee 4.50"
    ]
  },
  accounts: {
    category: "Basic Accounting",
    description: "List account balances.",
    usage: "/accounts",
    examples: [
      "/accounts"
    ]
  },
  save: {
    category: "Basic Accounting",
    description: "Move money from bank to savings.",
    usage: "/save <amount>",
    examples: [
      "/save 50",
      "/save 94.59"
    ]
  },
  forecast: {
    category: "Forecasting",
    description: "Show upcoming recurring balance changes.",
    usage: "/forecast",
    examples: [
      "/forecast"
    ]
  },
  add_help_note: {
    category: "meta",
    description: "Use /<command> help for command-specific help."
  }
};
