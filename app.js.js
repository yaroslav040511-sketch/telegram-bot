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
    
    // Таблица премиум-пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS premium_users (
        user_id BIGINT PRIMARY KEY,
        valid_until TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Таблица бюджетов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        category VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        UNIQUE(user_id, category, month, year)
      )
    `);
    
    console.log('✅ Все таблицы созданы');
    
    const testQuery = await pool.query('SELECT COUNT(*) FROM transactions');
    console.log(`📊 Всего записей в базе: ${testQuery.rows[0].count}`);
    
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

// ==================== КАТЕГОРИИ ====================
const categories = {
  '🍔 Еда': ['еда', 'кофе', 'обед', 'продукты', 'ресторан', 'пицца', 'кафе', 'суши', 'бургер', 'завтрак', 'ужин', 'шаурма', 'хлеб', 'молоко'],
  '🚗 Транспорт': ['такси', 'метро', 'бензин', 'автобус', 'троллейбус', 'трамвай', 'маршрутка', 'электричка', 'авиабилет', 'поезд'],
  '🎮 Развлечения': ['кино', 'игры', 'бар', 'клуб', 'концерт', 'пиво', 'кальян', 'боулинг', 'квест', 'парк', 'театр'],
  '🏥 Здоровье': ['аптека', 'врач', 'лекарства', 'больница', 'таблетки', 'анализы', 'стоматолог', 'спортзал', 'фитнес'],
  '📱 Связь': ['интернет', 'телефон', 'связь', 'мтс', 'билайн', 'мегафон', 'теле2', 'роуминг', 'тариф'],
  '🏠 Дом': ['коммуналка', 'квартплата', 'жкх', 'ремонт', 'мебель', 'посуда', 'техника', 'хозтовары'],
  '👕 Одежда': ['одежда', 'обувь', 'джинсы', 'футболка', 'куртка', 'кроссовки', 'кеды', 'платье', 'костюм'],
  '💰 Зарплата': ['зарплата', 'аванс', 'зп', 'доход', 'перевод', 'премия', 'бонус', 'заработок', 'фриланс'],
  '🎓 Образование': ['курсы', 'обучение', 'книги', 'учебники', 'тренинг', 'вебинар', 'школа', 'университет'],
  '🎁 Подарки': ['подарок', 'цветы', 'сюрприз', 'др', 'день рождения'],
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

// ==================== ПРОВЕРКА ПРЕМИУМ ====================
async function isPremium(userId) {
  try {
    const result = await pool.query(
      'SELECT * FROM premium_users WHERE user_id = $1 AND valid_until > NOW()',
      [userId]
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error('Ошибка проверки премиум:', err);
    return false;
  }
}

// ==================== СОЗДАНИЕ БОТА ====================
const bot = new Telegraf(token);

// ==================== КНОПКИ И МЕНЮ ====================

// Главное меню
const mainMenu = Markup.keyboard([
  ['💰 Добавить доход', '💸 Добавить расход'],
  ['📊 Статистика', '📈 Бюджеты'],
  ['⭐ Премиум', '📋 Мои записи'],
  ['❓ Помощь']
]).resize();

// Кнопка отмены (возврат в меню)
const backToMenu = Markup.keyboard(['🔙 В главное меню']).resize();

// Состояния пользователей (чтобы знать, ждем ли мы сумму)
const userStates = new Map();

// ==================== КОМАНДЫ ====================

// СТАРТ
bot.start(async (ctx) => {
  const welcome = `
👋 Привет! Я твой **финансовый помощник**!

📝 **Как записывать:**
• Просто пиши сумму и что купил
• "500 зарплата" - доход
• "кофе 300" - расход
• "-300 такси" - тоже расход

🎯 **Возможности:**
• Автоопределение категорий
• Статистика по дням/месяцам/годам
• Бюджеты и лимиты
• Премиум-функции

⬇️ Используй кнопки ниже ⬇️
  `;
  
  await ctx.reply(welcome, { parse_mode: 'Markdown' });
  await ctx.reply('Главное меню:', mainMenu);
  console.log(`👋 Новый пользователь: ${ctx.from.id} (@${ctx.from.username || 'no username'})`);
});

// ПОМОЩЬ
bot.help(async (ctx) => {
  const help = `
📚 **Доступные команды:**

💰 **Доходы и расходы:**
• Просто пиши сумму и описание
  Пример: "500 зарплата"
  Пример: "кофе 300"
  Пример: "-300 такси"

📊 **Статистика:**
/stats - вся статистика
/stats week - за неделю
/stats month - за месяц
/stats year - за год

📈 **Бюджеты:**
/budget - управление бюджетами

⭐ **Премиум:**
/premium - информация о премиум-доступе

❓ **Помощь:**
/help - это меню
  `;
  
  await ctx.reply(help, { parse_mode: 'Markdown' });
});

// Возврат в главное меню
bot.hears('🔙 В главное меню', async (ctx) => {
  userStates.delete(ctx.from.id);
  await ctx.reply('Главное меню:', mainMenu);
});

// Обработка кнопок
bot.hears('💰 Добавить доход', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_income');
  await ctx.reply('Напиши сумму и описание дохода (например: "50000 зарплата")', backToMenu);
});

bot.hears('💸 Добавить расход', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_expense');
  await ctx.reply('Напиши сумму и описание расхода (например: "кофе 300" или "-300 такси")', backToMenu);
});

bot.hears('📊 Статистика', async (ctx) => {
  await showStats(ctx, 'all');
});

bot.hears('📈 Бюджеты', async (ctx) => {
  await ctx.reply('🚧 Функция бюджетов в разработке. Скоро появится!', mainMenu);
});

bot.hears('⭐ Премиум', async (ctx) => {
  await showPremium(ctx);
});

bot.hears('📋 Мои записи', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC LIMIT 10',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return ctx.reply('📋 У вас пока нет записей', mainMenu);
    }
    
    let message = '📋 **Последние 10 записей:**\n\n';
    result.rows.forEach((tx, i) => {
      const emoji = tx.type === 'income' ? '💰' : '💸';
      const date = new Date(tx.date).toLocaleString('ru-RU');
      message += `${emoji} **${tx.amount}₽** - ${tx.category}\n`;
      message += `   📝 ${tx.description}\n`;
      message += `   🕐 ${date}\n\n`;
    });
    
    await ctx.reply(message, { parse_mode: 'Markdown', ...mainMenu });
    
  } catch (err) {
    console.error('❌ Ошибка получения записей:', err);
    ctx.reply('❌ Ошибка получения записей', mainMenu);
  }
});

bot.hears('❓ Помощь', async (ctx) => {
  ctx.help();
});

// СТАТИСТИКА
bot.command('stats', async (ctx) => {
  const text = ctx.message.text;
  const parts = text.split(' ');
  let period = parts[1] || 'all';
  await showStats(ctx, period);
});

async function showStats(ctx, period = 'all') {
  try {
    const userId = ctx.from.id;
    
    let interval = '9999 days';
    let periodText = 'за всё время';
    
    if (period === 'week') {
      interval = '7 days';
      periodText = 'за неделю';
    } else if (period === 'month') {
      interval = '30 days';
      periodText = 'за месяц';
    } else if (period === 'year') {
      interval = '365 days';
      periodText = 'за год';
    }
    
    console.log(`📊 Stats for user ${userId}, interval: ${interval}`);
    
    // Получаем доходы
    const incomes = await pool.query(`
      SELECT 
        category,
        SUM(amount) as total,
        COUNT(*) as count
      FROM transactions 
      WHERE user_id = $1 
        AND type = 'income'
        AND date > NOW() - $2::interval
      GROUP BY category
      ORDER BY total DESC
    `, [userId, interval]);
    
    // Получаем расходы
    const expenses = await pool.query(`
      SELECT 
        category,
        SUM(amount) as total,
        COUNT(*) as count
      FROM transactions 
      WHERE user_id = $1 
        AND type = 'expense'
        AND date > NOW() - $2::interval
      GROUP BY category
      ORDER BY total DESC
    `, [userId, interval]);
    
    console.log(`📊 Found ${incomes.rows.length} income categories, ${expenses.rows.length} expense categories`);
    
    const totalIncome = incomes.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    const totalExpense = expenses.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    
    let message = `📊 **Статистика ${periodText}:**\n\n`;
    
    if (incomes.rows.length > 0) {
      message += '💰 **Доходы:**\n';
      incomes.rows.forEach(row => {
        message += `  ${row.category}: ${Number(row.total).toFixed(2)}₽ (${row.count} раз)\n`;
      });
      message += `  **Всего доходов:** ${totalIncome.toFixed(2)}₽\n\n`;
    } else {
      message += '💰 **Доходы:** пока нет\n\n';
    }
    
    if (expenses.rows.length > 0) {
      message += '💸 **Расходы:**\n';
      expenses.rows.forEach(row => {
        message += `  ${row.category}: ${Number(row.total).toFixed(2)}₽ (${row.count} раз)\n`;
      });
      message += `  **Всего расходов:** ${totalExpense.toFixed(2)}₽\n\n`;
    } else {
      message += '💸 **Расходы:** пока нет\n\n';
    }
    
    const balance = totalIncome - totalExpense;
    message += `💰 **Баланс:** ${balance.toFixed(2)}₽`;
    if (balance > 0) message += ' ✅';
    else if (balance < 0) message += ' ⚠️';
    
    // Добавляем кнопки для быстрой статистики
    const statsKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📅 Неделя', 'stats_week')],
      [Markup.button.callback('📅 Месяц', 'stats_month'), Markup.button.callback('📅 Год', 'stats_year')],
      [Markup.button.callback('📊 Всё время', 'stats_all')]
    ]);
    
    await ctx.reply(message, { parse_mode: 'Markdown', ...statsKeyboard });
    
  } catch (err) {
    console.error('❌ Ошибка статистики:', err);
    ctx.reply('❌ Ошибка получения статистики: ' + err.message);
  }
}

// Обработка инлайн-кнопок статистики
bot.action(/stats_(.+)/, async (ctx) => {
  const period = ctx.match[1];
  await ctx.deleteMessage();
  await showStats(ctx, period);
});

// ТЕСТ
bot.command('test', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const result = await pool.query('SELECT NOW() as time');
    const count = await pool.query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [userId]);
    
    const lastTx = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC LIMIT 5',
      [userId]
    );
    
    let txList = '';
    if (lastTx.rows.length > 0) {
      txList = '\n\n📋 **Последние записи:**\n';
      lastTx.rows.forEach((tx, i) => {
        const emoji = tx.type === 'income' ? '💰' : '💸';
        const date = new Date(tx.date).toLocaleString('ru-RU');
        txList += `${emoji} ${tx.amount}₽ - ${tx.category} (${tx.description})\n   🕐 ${date}\n`;
      });
    }
    
    await ctx.reply(
      `✅ **База данных подключена!**\n` +
      `🕐 Время сервера: ${result.rows[0].time}\n` +
      `📊 Ваших транзакций: ${count.rows[0].count}` +
      txList,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('❌ Ошибка теста БД:', err);
    ctx.reply('❌ Ошибка подключения к базе данных');
  }
});

// ПРЕМИУМ
bot.command('premium', async (ctx) => {
  await showPremium(ctx);
});

async function showPremium(ctx) {
  const userId = ctx.from.id;
  const premium = await isPremium(userId);
  
  if (premium) {
    const result = await pool.query('SELECT valid_until FROM premium_users WHERE user_id = $1', [userId]);
    const validUntil = new Date(result.rows[0].valid_until).toLocaleDateString('ru-RU');
    
    await ctx.reply(
      `⭐ **У вас активен премиум-доступ!**\n\n` +
      `Действует до: ${validUntil}\n\n` +
      `✅ Все премиум-функции доступны:\n` +
      `• Неограниченное количество транзакций\n` +
      `• Расширенная статистика\n` +
      `• Экспорт в Excel\n` +
      `• Приоритетная поддержка`,
      { parse_mode: 'Markdown', ...mainMenu }
    );
  } else {
    const premiumKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💎 Купить за 100 Telegram Stars', 'buy_premium')],
      [Markup.button.url('📱 Оплатить через ЮKassa', 'https://t.me/xxx')]
    ]);
    
    await ctx.reply(
      `⭐ **Премиум-доступ**\n\n` +
      `**Что дает премиум:**\n` +
      `• 📊 Расширенная статистика с графиками\n` +
      `• 📈 Бюджеты и лимиты по категориям\n` +
      `• 📉 Прогнозы и аналитика\n` +
      `• 📎 Экспорт в Excel/CSV\n` +
      `• 🔔 Уведомления о превышении бюджета\n` +
      `• ⭐ Приоритетная поддержка\n\n` +
      `**Стоимость:** 100 Telegram Stars в месяц\n` +
      `**Годовая подписка:** 1000 Stars (скидка 20%)`,
      { parse_mode: 'Markdown', ...premiumKeyboard }
    );
  }
}

bot.action('buy_premium', async (ctx) => {
  await ctx.answerCbQuery();
  
  // Telegram Stars платеж
  await ctx.replyWithInvoice({
    title: '⭐ Премиум-подписка на месяц',
    description: 'Доступ ко всем премиум-функциям на 30 дней',
    payload: 'premium_month',
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: 'Премиум', amount: 100 }],
    start_parameter: 'premium-payment'
  });
});

// Обработка успешной оплаты
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on('successful_payment', async (ctx) => {
  const userId = ctx.from.id;
  
  // Активируем премиум на 30 дней
  await pool.query(
    'INSERT INTO premium_users (user_id, valid_until) VALUES ($1, NOW() + INTERVAL \'30 days\') ON CONFLICT (user_id) DO UPDATE SET valid_until = NOW() + INTERVAL \'30 days\'',
    [userId]
  );
  
  await ctx.reply(
    '✅ **Оплата прошла успешно!**\n\n' +
    'Премиум-доступ активирован на 30 дней.\n' +
    'Спасибо за поддержку! 🙏',
    { parse_mode: 'Markdown', ...mainMenu }
  );
});

// ==================== ОБРАБОТКА ТЕКСТА ====================
bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    
    // Пропускаем команды и кнопки меню
    if (text.startsWith('/') || 
        text === '💰 Добавить доход' || 
        text === '💸 Добавить расход' ||
        text === '📊 Статистика' ||
        text === '📈 Бюджеты' ||
        text === '⭐ Премиум' ||
        text === '📋 Мои записи' ||
        text === '❓ Помощь' ||
        text === '🔙 В главное меню') {
      return;
    }
    
    console.log(`📨 Сообщение от ${userId}: "${text}"`);
    
    // Парсим сумму
    const match = text.match(/(-?\d+[\d\s]*[\d,.]*|\d+[\d\s]*[\d,.]*)/);
    if (!match) {
      await ctx.reply('❌ Не могу найти сумму. Пример: "500 зарплата" или "кофе 300"', backToMenu);
      return;
    }
    
    let amount = parseFloat(match[0].replace(/\s/g, '').replace(',', '.'));
    const description = text.replace(match[0], '').trim() || 'без описания';
    
    // Определяем тип в зависимости от состояния или текста
    let type = 'expense';
    const incomeKeywords = ['зарплата', 'доход', 'аванс', 'зп', 'перевод', 'премия', 'бонус', 'заработок', 'фриланс'];
    const isIncome = incomeKeywords.some(keyword => text.toLowerCase().includes(keyword));
    
    if (state === 'waiting_income' || isIncome) {
      type = 'income';
    } else if (state === 'waiting_expense' || amount < 0) {
      type = 'expense';
      if (amount < 0) amount = Math.abs(amount);
    } else {
      type = 'expense';
    }
    
    const category = detectCategory(text);
    
    // Сохраняем
    await pool.query(
      'INSERT INTO transactions (user_id, amount, category, description, type) VALUES ($1, $2, $3, $4, $5)',
      [userId, amount, category, description, type]
    );
    
    console.log(`✅ Сохранено: user=${userId}, amount=${amount}, category=${category}, type=${type}`);
    
    const emoji = type === 'income' ? '💰' : '💸';
    await ctx.reply(
      `${emoji} **Записано:** ${type === 'income' ? 'доход' : 'расход'} ${amount}₽\n` +
      `📌 **Категория:** ${category}`,
      { parse_mode: 'Markdown' }
    );
    
    // Очищаем состояние и возвращаем в главное меню
    userStates.delete(userId);
    await ctx.reply('Что делаем дальше?', mainMenu);
    
  } catch (err) {
    console.error('❌ Ошибка обработки сообщения:', err);
    ctx.reply('❌ Произошла ошибка. Попробуй еще раз.', mainMenu);
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