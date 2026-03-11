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

if (!process.env.DATABASE_URL) {
  console.error('❌ ОШИБКА: DATABASE_URL не задан!');
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
    // Таблица транзакций
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
    console.log('✅ Таблица transactions создана или уже существует');
    
    // Проверим, есть ли данные
    const testQuery = await pool.query('SELECT COUNT(*) FROM transactions');
    console.log(`📊 Всего записей в базе: ${testQuery.rows[0].count}`);
    
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

// ==================== КАТЕГОРИИ ====================
const categories = {
  '🍔 Еда': ['еда', 'кофе', 'обед', 'продукты', 'ресторан', 'пицца', 'кафе', 'суши', 'бургер', 'завтрак', 'ужин'],
  '🚗 Транспорт': ['такси', 'метро', 'бензин', 'автобус', 'троллейбус', 'трамвай', 'маршрутка'],
  '🎮 Развлечения': ['кино', 'игры', 'бар', 'клуб', 'концерт', 'пиво', 'кальян', 'боулинг'],
  '🏥 Здоровье': ['аптека', 'врач', 'лекарства', 'больница', 'таблетки', 'анализы'],
  '📱 Связь': ['интернет', 'телефон', 'связь', 'мтс', 'билайн', 'мегафон', 'теле2'],
  '🏠 Дом': ['коммуналка', 'квартплата', 'жкх', 'ремонт', 'мебель', 'посуда'],
  '👕 Одежда': ['одежда', 'обувь', 'джинсы', 'футболка', 'куртка', 'кроссовки'],
  '💰 Зарплата': ['зарплата', 'аванс', 'зп', 'доход', 'перевод', 'премия', 'бонус'],
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

📝 Как записывать траты:
• "500 зарплата" - доход
• "-300 кофе" - расход
• "кофе 300" - тоже расход (без минуса)
• "такси 500" - расход

Команды:
/stats - статистика за месяц
/stats week - за неделю
/stats year - за год
/test - проверить подключение
/help - помощь
  `;
  await ctx.reply(welcome);
  console.log(`👋 Новый пользователь: ${ctx.from.id} (@${ctx.from.username || 'no username'})`);
});

// ТЕСТ БАЗЫ
bot.command('test', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const result = await pool.query('SELECT NOW() as time');
    const count = await pool.query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [userId]);
    
    // Покажем последние 5 транзакций
    const lastTx = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC LIMIT 5',
      [userId]
    );
    
    let txList = '';
    if (lastTx.rows.length > 0) {
      txList = '\n\n📋 Последние записи:\n';
      lastTx.rows.forEach((tx, i) => {
        const emoji = tx.type === 'income' ? '💰' : '💸';
        txList += `${emoji} ${tx.amount}₽ - ${tx.category} (${tx.description})\n`;
      });
    }
    
    await ctx.reply(
      `✅ База данных подключена!\n` +
      `🕐 Время сервера: ${result.rows[0].time}\n` +
      `📊 Ваших транзакций: ${count.rows[0].count}` +
      txList
    );
  } catch (err) {
    console.error('❌ Ошибка теста БД:', err);
    ctx.reply('❌ Ошибка подключения к базе данных');
  }
});

// СТАТИСТИКА
bot.command('stats', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const parts = text.split(' ');
    let period = '30 days';
    let periodText = 'за месяц';
    
    if (parts.length > 1) {
      if (parts[1] === 'week') {
        period = '7 days';
        periodText = 'за неделю';
      } else if (parts[1] === 'year') {
        period = '365 days';
        periodText = 'за год';
      }
    }
    
    console.log(`📊 Статистика для user=${userId}, период=${period}`);
    
    // Получаем расходы
    const expenses = await pool.query(`
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
    
    // Получаем доходы
    const incomes = await pool.query(`
      SELECT 
        SUM(amount) as total
      FROM transactions 
      WHERE user_id = $1 
        AND date > NOW() - $2::interval
        AND type = 'income'
    `, [userId, period]);
    
    const totalIncome = parseFloat(incomes.rows[0]?.total || 0);
    const totalExpense = expenses.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    
    console.log(`📊 Найдено расходов: ${expenses.rows.length}, доходов: ${totalIncome}`);
    
    let message = `📊 Статистика ${periodText}:\n\n`;
    
    if (totalIncome > 0) {
      message += `💰 Доходы: ${totalIncome.toFixed(2)}₽\n`;
    }
    
    if (expenses.rows.length === 0) {
      message += '💸 Расходов нет\n';
    } else {
      message += '💸 Расходы по категориям:\n';
      expenses.rows.forEach(row => {
        message += `  ${row.category}: ${Number(row.total).toFixed(2)}₽ (${row.count} раз)\n`;
      });
      message += `\n💵 Всего расходов: ${totalExpense.toFixed(2)}₽\n`;
    }
    
    if (totalIncome > 0) {
      const balance = totalIncome - totalExpense;
      message += `💰 Баланс: ${balance.toFixed(2)}₽`;
      if (balance > 0) {
        message += ' ✅';
      } else if (balance < 0) {
        message += ' ⚠️';
      }
    }
    
    await ctx.reply(message);
    
  } catch (err) {
    console.error('❌ Ошибка статистики:', err);
    ctx.reply('❌ Ошибка получения статистики');
  }
});

// ПОМОЩЬ
bot.command('help', async (ctx) => {
  const help = `
📚 Доступные команды:

💰 Доходы и расходы:
• Просто пиши сумму и описание
  Пример: "500 зарплата" - доход
  Пример: "-300 кофе" - расход
  Пример: "кофе 300" - тоже расход
  Пример: "такси 500" - расход

📊 Статистика:
/stats - за месяц
/stats week - за неделю
/stats year - за год

🔄 Проверка:
/test - проверить подключение к базе
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
    
    console.log(`📨 Сообщение от ${userId}: "${text}"`);
    
    // Парсим сумму
    const match = text.match(/(-?\d+[\d\s]*[\d,.]*|\d+[\d\s]*[\d,.]*)/);
    if (!match) {
      return ctx.reply('❌ Не могу найти сумму. Пример: "500 зарплата" или "-300 кофе"');
    }
    
    let amount = parseFloat(match[0].replace(/\s/g, '').replace(',', '.'));
    const description = text.replace(match[0], '').trim() || 'без описания';
    
    // Определяем тип (доход или расход)
    let type = 'expense'; // по умолчанию расход
    
    // Ключевые слова для дохода
    const incomeKeywords = ['зарплата', 'доход', 'аванс', 'зп', 'перевод', 'премия', 'бонус', 'заработок'];
    const isIncome = incomeKeywords.some(keyword => text.toLowerCase().includes(keyword));
    
    if (amount < 0) {
      // Если пользователь поставил минус - это точно расход
      type = 'expense';
      amount = Math.abs(amount);
    } else if (isIncome) {
      // Если есть ключевые слова дохода - это доход
      type = 'income';
    } else {
      // Во всех остальных случаях - расход
      type = 'expense';
    }
    
    const category = detectCategory(text);
    
    // Сохраняем в базу
    await pool.query(
      'INSERT INTO transactions (user_id, amount, category, description, type) VALUES ($1, $2, $3, $4, $5)',
      [userId, amount, category, description, type]
    );
    
    console.log(`✅ Сохранено: user=${userId}, amount=${amount}, category=${category}, type=${type}`);
    
    const emoji = type === 'income' ? '💰' : '💸';
    await ctx.reply(`${emoji} Записано: ${type === 'income' ? 'доход' : 'расход'} ${amount}₽\nКатегория: ${category}`);
    
  } catch (err) {
    console.error('❌ Ошибка обработки сообщения:', err);
    ctx.reply('❌ Произошла ошибка. Попробуй еще раз.');
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
  console.log(`🌐 Сервер запущен на порту ${PORT}`);
});

// ==================== ЗАПУСК БОТА ====================
async function startBot() {
  await initDatabase();
  await bot.launch();
  console.log('✅ Бот запущен и готов к работе!');
  console.log('👀 Открывай Telegram и пиши /start');
}

startBot().catch(err => {
  console.error('❌ Ошибка запуска бота:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));