# Bot Command Reference

This bot provides personal finance tracking, forecasting, debt planning
and retirement projections via Telegram. It uses OpenClaw as a gateway.

This bot also supports both command input and natural language using AI.

---

Examples:

/add groceries 25  
or  
bought groceries for 25  

/deposit 500 paycheck  
or  
I got paid 500 

---

Quick start:

/money
/status
/future
/milestones
/rich

---

# Basic Accounting

| Command | Description | Example |
|-------|-------------|--------|
| `/add` | Add an expense | `/add groceries 25` |
| `/deposit` | Add money to bank | `/deposit 500 paycheck` |
| `/withdraw` | Remove money from bank | `/withdraw 50 cash` |
| `/balance` | Show bank balance | `/balance` |
| `/savings` | Save money to savings | `/savings 50` |
| `/savings` | Show bank savings balance | `/savings' |
| `/accounts` | List account balances | `/accounts` |
| `/networth` | Show assets minus liabilities | `/networth` |
| `/history` | Show recent transactions | `/history` |
| `/undo` | Remove last transaction | `/undo` |
| `/status` | Financial dashboard summary | `/status` |
| `/money` | Financial snapshot | `/money` |
| `/financial_health` | Financial scorecard | `/financial_health` |

---

# Financial Planning

| Command | Description | Example |
|---------|-------------|---------|
| `/money_graph` | Graph of bank, debt and net worth projection | `/money_graph` |
| `/future` | Financial projection graph | `/future 24` |
| `/milestones` | Key financial milestones | `/milestones` |
| `/milestones_graph` | Visual timeline of milestones | `/milestones_graph` |
| `/rich` | Long-term wealth timeline ($50k → $1M) | `/rich` |

---

# Planning Tools

| Command | Description | Example |
|---------|-------------|---------|
| `/caniafford` | Check if a purchase is safe | `/caniafford 1500` |
| `/goal` | Savings goal calculator | `/goal 5000` |
| `/emergency_fund` | Emergency fund target analysis | `/emergency_fund` |

---

# Forecasting

| Command | Description | Example |
|-------|-------------|--------|
| `/forecast` | Text forecast of upcoming balance | `/forecast` |
| `/forecastgraph` | 30-day balance projection chart | `/forecastgraph` |
| `/whatif` | Simulate balance with a hypothetical spend | `/whatif 50` |
| `/upcoming` | Show upcoming recurring events | `/upcoming bill 60 25` |
| `/year_projection` | 12-month projection using recurring cashflow | `/year_projection` |

---

# Recurring Transactions

| Command | Description | Example |
|-------|-------------|--------|
| `/recurring` | Add recurring bill | `/recurring rent 1200 monthly 1` |
| `/recurring_income` | Add recurring income | `/recurring_income salary 2500 monthly 1` |
| `/recurring_list` | List recurring items | `/recurring_list` |
| `/recurring_delete` | Delete recurring item | `/recurring_delete 3` |
| `/runrecurring` | Run recurring transactions now | `/runrecurring` |

---

# Monthly Reports

| Command | Description | Example |
|-------|-------------|--------|
| `/monthly` | This month's income, expenses, and net | `/monthly` |
| `/monthly_detail` | Income vs expense breakdown | `/monthly_detail` |
| `/burnrate` | Monthly spending vs income and runway | `/burnrate` |
| `/cashflow` | Recurring monthly income vs bills | `/cashflow` |
| `/cashflow_detail` | Recurring cashflow breakdown | `/cashflow_detail` |

---

# Debt Analysis

| Command | Description | Example |
|---------|-------------|---------|
| `/debt_compare_range_graph` | Compare snowball vs avalanche across payment ranges | `/debt_compare_range_graph` |
| `/best_extra` | Find the most effective extra payment | `/best_extra 100 500 100` |

---

# Debt Management

| Command | Description | Example |
|-------|-------------|--------|
| `/debt_add` | Add a debt | `/debt_add chase 5400 21.9 125` |
| `/debt_edit` | Edit balance, APR, or minimum | `/debt_edit chase apr 19.9` |
| `/debt_pay` | Apply payment to a debt | `/debt_pay chase 200` |
| `/debts` | List all debts | `/debts` |
| `/debt_total` | Show total debt summary | `/debt_total` |
| `/debt_strategy` | Show payoff order | `/debt_strategy avalanche` |
| `/debt_plan` | Show payment plan with extra payment | `/debt_plan avalanche 300` |
| `/debt_sim` | Full payoff simulation | `/debt_sim avalanche 300` |
| `/debt_compare` | Compare snowball vs avalanche | `/debt_compare 300` |
| `/debt_graph` | Graph debt payoff | `/debt_graph avalanche 300` |
| `/debt_compare_graph` | Graph strategy comparison | `/debt_compare_graph 300` |

---

# Retirement / FI

| Command | Description | Example |
|-------|-------------|--------|
| `/retirement` | Retirement target projection | `/retirement 500 7 1000000` |
| `/retirement_auto` | Retirement projection using recurring surplus | `/retirement_auto 7 1000000` |
| `/retirement_fi` | Financial Independence projection using the 4% rule | `/retirement_fi 7` |

---

# Runtime / Admin

| Command | Description | Example |
|-------|-------------|--------|
| `/botstatus` | Local bot runtime status | `/botstatus` |
| `/ocstatus` | OpenClaw runtime status | `/ocstatus` |

---

# Natural Language Transactions

Supports both command-based input and natural language.

The bot can interpret plain English messages and convert them into balanced accounting entries automatically.

Examples:

/add groceries 20
bought groceries for 20
Salary 1000
I got paid 5000 windfall
paid rent 1200
