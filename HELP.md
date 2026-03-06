# Bot Command Reference

This bot provides personal finance tracking, forecasting, and debt planning via Telegram.

---

# Basic Accounting

| Command | Description | Example |
|-------|-------------|--------|
| `/add` | Add an expense | `/add groceries 25` |
| `/deposit` | Add money to bank | `/deposit 500 paycheck` |
| `/withdraw` | Remove money from bank | `/withdraw 50 cash` |
| `/balance` | Show bank balance | `/balance` |
| `/accounts` | List account balances | `/accounts` |
| `/networth` | Show assets minus liabilities | `/networth` |
| `/history` | Show recent transactions | `/history` |
| `/undo` | Remove last transaction | `/undo` |

---

# Forecasting

| Command | Description |
|-------|-------------|
| `/forecast` | Text forecast of upcoming balance |
| `/forecastgraph` | 30-day balance projection chart |
| `/whatif` | Simulate balance with hypothetical changes |

---

# Recurring Transactions

| Command | Description | Example |
|-------|-------------|--------|
| `/recurring` | Add recurring bill | `/recurring rent 1200 monthly 1` |
| `/recurring_income` | Add recurring income | `/recurring_income salary 2500 monthly 1` |
| `/recurring_list` | List recurring items | |
| `/recurring_delete` | Delete recurring item | `/recurring_delete 3` |
| `/runrecurring` | Run recurring transactions now | |
| `/upcoming` | Show upcoming recurring events | `/upcoming bill 60 25` |

---

# Monthly Reports

| Command | Description |
|-------|-------------|
| `/monthly_detail` | Income vs expense breakdown |
| `/burnrate` | Monthly spending vs income |
| `/projection` | 12-month financial projection |

---

# Debt Management

| Command | Description | Example |
|-------|-------------|--------|
| `/debt_add` | Add a debt | `/debt_add chase 5400 21.9 125` |
| `/debt_edit` | Edit balance/APR/minimum | `/debt_edit chase apr 19.9` |
| `/debt_pay` | Apply payment to a debt | `/debt_pay chase 200` |
| `/debts` | List all debts | |
| `/debt_total` | Show total debt | |
| `/debt_strategy` | Show payoff order | `/debt_strategy avalanche` |
| `/debt_plan` | Plan payments | `/debt_plan avalanche 300` |
| `/debt_sim` | Full payoff simulation | `/debt_sim avalanche 300` |
| `/debt_compare` | Compare snowball vs avalanche | `/debt_compare 300` |
| `/debt_graph` | Graph debt payoff | `/debt_graph avalanche 300` |
| `/debt_compare_graph` | Graph strategy comparison | `/debt_compare_graph 300` |

---

# Tips

Quotes allow multi-word descriptions:

Example:

"CVS Pharmacy"

# Natural Language Transactions

Supports both command-based input and natural language.

The bot can interpret plain English messages and convert them into accounting entries.

Examples:

/add groceries 20
or
bought groceries for 20

Salary 1000
I got paid 5000 windfall
paid rent 1200


The AI converts these into balanced ledger transactions automatically.
