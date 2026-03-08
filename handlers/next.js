// handlers/next.js
module.exports = function registerNextHandler(bot, deps) {

  const { db, ledgerService } = deps;

  function money(n) {
    return `$${(Number(n) || 0).toFixed(2)}`
  }

  function monthlyMultiplier(freq) {
    switch ((freq || "").toLowerCase()) {
      case "daily": return 30
      case "weekly": return 4.33
      case "monthly": return 1
      case "yearly": return 1 / 12
      default: return 0
    }
  }

  function getRecurringMonthlyNet() {
    const rows = db.prepare(`
      SELECT postings_json, frequency
      FROM recurring_transactions
    `).all()

    let income = 0
    let bills = 0

    for (const r of rows) {
      try {
        const postings = JSON.parse(r.postings_json)

        const bankLine = Array.isArray(postings)
          ? postings.find(p => p.account === "assets:bank")
          : null

        if (!bankLine) continue

        const amt = Number(bankLine.amount) || 0
        const monthly = Math.abs(amt) * monthlyMultiplier(r.frequency)

        if (amt > 0) income += monthly
        if (amt < 0) bills += monthly

      } catch { }
    }

    return income - bills
  }

  function getDebtRows() {
    return db.prepare(`
      SELECT name,balance,apr,minimum
      FROM debts
    `).all().map(r => ({
      name: r.name,
      balance: Number(r.balance) || 0,
      apr: Number(r.apr) || 0,
      minimum: Number(r.minimum) || 0
    }))
  }

  function highestAprDebt(debts) {
    if (!debts.length) return null
    return [...debts].sort((a, b) => b.apr - a.apr)[0]
  }

  bot.onText(/^\/next(@\w+)?$/i, (msg) => {

    const chatId = msg.chat.id

    try {

      const balances = ledgerService.getBalances()

      let bank = 0
      let savings = 0

      for (const b of balances) {
        if (b.account === "assets:bank") bank = Number(b.balance) || 0
        if (b.account === "assets:savings") savings = Number(b.balance) || 0
      }

      const debts = getDebtRows()
      const totalDebt = debts.reduce((s, d) => s + d.balance, 0)
      const monthlyNet = getRecurringMonthlyNet()
      const target = highestAprDebt(debts)

      let out = "🚀 Next Move\n\n"

      if (bank < 100) {

        out += "Protect cash immediately.\n\n"
        out += "Why:\n"
        out += "• Balance under $100\n"
        out += "• Risk of overdraft\n\n"
        out += "Action:\n"
        out += "Avoid discretionary spending."

      }

      else if (totalDebt > 0 && monthlyNet > 0 && target) {

        const extra = Math.round(monthlyNet / 2)

        out += `Pay about ${money(extra)} toward ${target.name}.\n\n`

        out += "Why:\n"
        out += `• Highest APR (${target.apr}%)\n`
        out += `• Debt balance ${money(target.balance)}\n`
        out += "• Monthly surplus available\n\n"

        out += "After that:\nRun /focus again."

      }

      else if (savings < 1000 && monthlyNet > 0) {

        const save = Math.round(monthlyNet / 2)

        out += `Move about ${money(save)} to savings.\n\n`

        out += "Why:\n"
        out += "• Emergency fund below $1000\n"
        out += "• Surplus cashflow available"

      }

      else if (monthlyNet > 0) {

        out += "Continue building wealth.\n\n"
        out += "Why:\n"
        out += "• Positive monthly surplus\n"
        out += "• Debt under control\n\n"

        out += "Consider investing surplus."

      }

      else {

        out += "Review recurring expenses.\n\n"
        out += "Why:\n"
        out += "• Monthly surplus is small or negative"

      }

      return bot.sendMessage(chatId, out)

    } catch (err) {

      console.error("next error:", err)
      return bot.sendMessage(chatId, "Error generating next move.")

    }

  })

}
