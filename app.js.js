// ==================== НАСТРОЙКИ ====================
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// ==================== ПРОВЕРКА ПЕРЕМЕННЫХ ====================
console.log('=== ДИАГНОСТИКА ===');
console.log('TELEGRAM_BOT_TOKEN установлен:', !!process.env.TELEGRAM_BOT_TOKEN);
console.log('DATABASE_URL установлен:', !!process.env.DATABASE_URL);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ ОШИБКА: TELEGRAM_BOT_TOKEN не задан!');
  process.exit(1);
}

// ==================== ПОДКЛЮЧЕНИЕ К БАЗЕ ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==================== СОЗДАНИЕ ТАБЛИЦ ====================
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        category VARCHAR(50),
        description TEXT,
        type VARCHAR(10) DEFAULT 'expense',
        date TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблицы созданы');
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

// ==================== КАТЕГОРИИ ====================
const categories = {
  '🍔 Еда': ['еда', 'кофе', 'обед', 'продукты', 'ресторан', 'пицца', 'кафе'],
  '🚗 Транспорт': ['такси', 'метро', 'бензин', 'автобус'],
  '🎮 Развлечения': ['кино', 'игры', 'бар', 'концерт'],
  '🏥 Здоровье': ['аптека', 'врач', 'лекарства'],
  '📱 Связь': ['интернет', 'телефон', 'связь'],
  '💰 Зарплата': ['зарплата', 'аванс', 'зп', 'доход'],
  '💸 Прочее': []
};

function detectCategory(text) {
  text = text.toLowerCase();
  for (const [category, keywords] of Object.entries(categories)) {
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        return category;
      }
    }
  }
  return '💸 Прочее';
}

// ==================== СОЗДАНИЕ БОТА ====================
const bot = new Telegraf(token);

// ==================== КОМАНДЫ ====================

// СТАРТ
bot.start(async (ctx) => {
  const welcome = `
👋 Привет! Я финансовый бот.

📝 Просто пиши мне траты и доходы:
• "500 зарплата" - доход
• "-300 кофе" - расход
• "обед 450" - расход

Команды:
/stats - статистика за месяц
/stats week - за неделю
/stats year - за год
/help - помощь
  `;
  await ctx.reply(welcome);
});

// СТАТИСТИКА
bot.command('stats', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const parts = text.split(' ');
    let period = '30 days';
    
    if (parts.length > 1) {
      if (parts[1] === 'week') period = '7 days';
      else if (parts[1] === 'year') period = '365 days';
    }
    
    const result = await pool.query(`
      SELECT 
        category,
        SUM(amount) as total,
        COUNT(*) as count
      FROM transactions 
      WHERE user_id = $1 
        AND date > NOW() - $2::interval
        AND type = 'expense'
      GROUP BY category
      ORDER BY total DESC
    `, [userId, period]);
    
    if (result.rows.length === 0) {
      return ctx.reply('📊 За этот период нет расходов');
    }
    
    let message = '📊 Статистика расходов:\n\n';
    let total = 0;
    
    result.rows.forEach(row => {
      message += `${row.category}: ${Number(row.total).toFixed(2)}₽ (${row.count} раз)\n`;
      total += parseFloat(row.total);
    });
    
    message += `\n💰 Всего: ${total.toFixed(2)}₽`;
    await ctx.reply(message);
    
  } catch (err) {
    console.error('Ошибка статистики:', err);
    ctx.reply('❌ Ошибка получения статистики');
  }
});

// ПОМОЩЬ
bot.command('help', async (ctx) => {
  const help = `
📚 Доступные команды:

💰 Доходы и расходы:
• Просто пиши сумму и описание
  Пример: "500 зарплата"
  Пример: "-300 кофе"
  Пример: "обед 450"

📊 Статистика:
/stats - за месяц
/stats week - за неделю
/stats year - за год
  `;
  await ctx.reply(help);
});

// ==================== ОБРАБОТКА ТЕКСТА ====================
bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    
    // Пропускаем команды
    if (text.startsWith('/')) return;
    
    // Парсим сумму
    const match = text.match(/(-?\d+[\d\s]*[\d,.]*|\d+[\d\s]*[\d,.]*)/);
    if (!match) {
      return ctx.reply('❌ Не могу найти сумму. Пример: "500 зарплата" или "-300 кофе"');
    }
    
    let amount = parseFloat(match[0].replace(/\s/g, '').replace(',', '.'));
    const description = text.replace(match[0], '').trim() || 'без описания';
    
    const type = amount > 0 ? 'income' : 'expense';
    const category = detectCategory(text);
    amount = Math.abs(amount);
    
    await pool.query(
      'INSERT INTO transactions (user_id, amount, category, description, type) VALUES ($1, $2, $3, $4, $5)',
      [userId, amount, category, description, type]
    );
    
    const emoji = type === 'income' ? '💰' : '💸';
    await ctx.reply(`${emoji} Записано: ${type === 'income' ? 'доход' : 'расход'} ${amount}₽\nКатегория: ${category}`);
    
  } catch (err) {
    console.error('Ошибка:', err);
    ctx.reply('❌ Произошла ошибка');
  }
});

// ==================== EXPRESS СЕРВЕР ====================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Бот работает!');
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// ==================== ЗАПУСК БОТА ====================
async function startBot() {
  await initDatabase();
  await bot.launch();
  console.log('✅ Бот запущен и готов к работе!');
}

startBot().catch(err => {
  console.error('❌ Ошибка запуска бота:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));