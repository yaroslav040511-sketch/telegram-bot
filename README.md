## A Telegram-based personal finance assistant with:

📒 Double-entry accounting

📊 Cashflow forecasting

🔁 Recurring bills & income

💳 Debt payoff optimization

📈 Financial graphs

🤖 AI transaction parsing

## Designed for simple Telegram input while maintaining accurate accounting internally.

## How This Bot Works

This project runs a personal finance bot on Telegram.
The system has three main parts:

Telegram App
     │
     ▼
OpenClaw Agent
     │
     ▼
AI Bot (this repository)
     │
     ▼
SQLite Ledger Database
Components
Telegram

## The user interacts with the bot using Telegram messages.

Examples:

/balance
/add groceries 25
/forecastgraph
/debt_compare 300

## Natural Language Transactions

The bot can interpret plain English messages and convert them into accounting entries.

Examples:


I got paid 5000 windfall
bought groceries for 35
paid rent 1200


The AI converts these into balanced ledger transactions automatically.

Telegram simply delivers messages to the bot.

OpenClaw (Gateway Layer)

OpenClaw acts as the message gateway and AI runtime.

It:

receives messages from Telegram

sends them to the bot

manages the AI model

handles session memory and context

Think of OpenClaw as the runtime environment for the assistant.

It is not responsible for accounting logic.

AI Bot (This Repository)

## This project contains the financial logic:

double-entry accounting

recurring transactions

cashflow simulation

debt optimization

forecasting graphs

## Handlers process commands such as:

/add
/balance
/forecastgraph
/debt_compare

Each command maps to a file in:

handlers/

Example:

handlers/balance.js
handlers/debt_sim.js
handlers/forecastgraph.js
SQLite Ledger

## All financial data is stored locally in:

data/ledger.sqlite

This includes:

accounts

transactions

postings

recurring items

debts

## The database schema is defined in:

models/db.js
Development Workflow

## Typical development loop:

edit code
↓
node index.js
↓
test commands in Telegram
↓
git commit
git push

Example:

git add .
git commit -m "add debt optimizer and graphs"
git push

## Key Idea

OpenClaw provides the AI runtime and gateway, while this project provides the financial engine.

OpenClaw = brain + gateway
ai-bot   = finance engine

See [HELP.md](HELP.md) for a full list of bot commands.
