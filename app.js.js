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
    
    // Таблица промокодов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promocodes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        max_uses INTEGER NOT NULL,
        used_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Таблица использованных промокодов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promocode_uses (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        promocode_id INTEGER REFERENCES promocodes(id),
        used_at TIMESTAMP DEFAULT NOW()
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
    
    // Создаем промокод VIP40 если его еще нет
    const checkPromo = await pool.query('SELECT * FROM promocodes WHERE code = $1', ['VIP40']);
    
    if (checkPromo.rows.length === 0) {
      await pool.query(
        'INSERT INTO promocodes (code, max_uses, used_count, is_active) VALUES ($1, $2, $3, $4)',
        ['VIP40', 40, 0, true]
      );
      console.log('🎫 Промокод VIP40 создан! (40 использований)');
    } else {
      console.log(`🎫 Промокод VIP40 уже существует, использовано: ${checkPromo.rows[0].used_count}/40`);
    }
    
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
  '💰 Зарплата': ['зарплата', 'доход', 'аванс', 'зп', 'перевод', 'премия', 'бонус', 'заработок', 'фриланс'],
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

// ==================== АКТИВАЦИЯ ПРЕМИУМ ====================
async function activatePremium(userId, days = 9999) {
  try {
    await pool.query(
      'INSERT INTO premium_users (user_id, valid_until) VALUES ($1, NOW() + $2::interval) ON CONFLICT (user_id) DO UPDATE SET valid_until = NOW() + $2::interval',
      [userId, `${days} days`]
    );
    return true;
  } catch (err) {
    console.error('Ошибка активации премиум:', err);
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
  ['⭐ Премиум', '🎫 Промокод'],
  ['📋 Мои записи', '❓ Помощь']
]).resize();

// Кнопка отмены (возврат в меню)
const backToMenu = Markup.keyboard(['🔙 В главное меню']).resize();

// Состояния пользователей
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
• Статистика
• Бюджеты и лимиты
• Премиум-функции

🎫 **Промокод VIP40** - премиум навсегда для первых 40 человек!

⬇️ Используй кнопки ниже ⬇️
  `;
  
  await ctx.reply(welcome, { parse_mode: 'Markdown' });
  await ctx.reply('Главное меню:', mainMenu);
  console.log(`👋 Новый пользователь: ${ctx.from.id} (@${ctx.from.username || 'no username'})`);
});

// ПОМОЩЬ
bot.command('help', async (ctx) => {
  const help = `
📚 **Доступные команды:**

💰 **Доходы и расходы:**
• Просто пиши сумму и описание
  Пример: "500 зарплата"
  Пример: "кофе 300"
  Пример: "-300 такси"

📊 **Статистика:**
/stats - вся статистика

🎫 **Промокоды:**
/promo - активировать промокод

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

bot.hears('🎫 Промокод', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_promo');
  await ctx.reply('🎫 Введите промокод:', backToMenu);
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
  // Вызываем команду help через бота
  await bot.telegram.sendMessage(ctx.chat.id, 
    `📚 **Доступные команды:**

💰 **Доходы и расходы:**
• Просто пиши сумму и описание
  Пример: "500 зарплата"
  Пример: "кофе 300"
  Пример: "-300 такси"

📊 **Статистика:**
/stats - вся статистика

🎫 **Промокоды:**
/promo - активировать промокод

⭐ **Премиум:**
/premium - информация о премиум-доступе

❓ **Помощь:**
/help - это меню`,
    { parse_mode: 'Markdown' }
  );
});

// КОМАНДА /stats
bot.command('stats', async (ctx) => {
  await showStats(ctx, 'all');
});

// КОМАНДА /promo
bot.command('promo', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_promo');
  await ctx.reply('🎫 Введите промокод:', backToMenu);
});

// ==================== СТАТИСТИКА ====================
async function showStats(ctx, period = 'all') {
  try {
    const userId = ctx.from.id;
    
    console.log(`🔍 Проверка для user ${userId}`);
    
    // Сначала проверим, есть ли вообще транзакции
    const allTx = await pool.query(
      'SELECT COUNT(*) as count FROM transactions WHERE user_id = $1',
      [userId]
    );
    console.log(`📊 Всего транзакций в базе: ${allTx.rows[0].count}`);
    
    // Получаем доходы
    const incomes = await pool.query(`
      SELECT 
        category,
        SUM(amount) as total,
        COUNT(*) as count
      FROM transactions 
      WHERE user_id = $1 AND type = 'income'
      GROUP BY category
      ORDER BY total DESC
    `, [userId]);
    
    // Получаем расходы
    const expenses = await pool.query(`
      SELECT 
        category,
        SUM(amount) as total,
        COUNT(*) as count
      FROM transactions 
      WHERE user_id = $1 AND type = 'expense'
      GROUP BY category
      ORDER BY total DESC
    `, [userId]);
    
    console.log(`💰 Найдено доходов: ${incomes.rows.length}, расходов: ${expenses.rows.length}`);
    
    const totalIncome = incomes.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    const totalExpense = expenses.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    
    let message = `📊 **Статистика за всё время:**\n\n`;
    
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
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (err) {
    console.error('❌ Ошибка статистики:', err);
    ctx.reply('❌ Ошибка получения статистики: ' + err.message);
  }
}

// ==================== ПРОМОКОДЫ ====================
async function activatePromo(userId, promoCode) {
  try {
    // Проверяем, активировал ли пользователь уже этот промокод
    const usedCheck = await pool.query(`
      SELECT pu.*, p.code FROM promocode_uses pu
      JOIN promocodes p ON pu.promocode_id = p.id
      WHERE pu.user_id = $1 AND p.code = $2
    `, [userId, promoCode]);
    
    if (usedCheck.rows.length > 0) {
      return { success: false, message: '❌ Вы уже активировали этот промокод' };
    }
    
    // Проверяем промокод
    const promo = await pool.query(
      'SELECT * FROM promocodes WHERE code = $1 AND is_active = true',
      [promoCode]
    );
    
    if (promo.rows.length === 0) {
      return { success: false, message: '❌ Промокод не найден' };
    }
    
    const promoData = promo.rows[0];
    
    if (promoData.used_count >= promoData.max_uses) {
      return { success: false, message: '❌ Промокод больше недействителен (лимит использований)' };
    }
    
    // Активируем премиум навсегда (9999 дней ≈ 27 лет)
    await activatePremium(userId, 9999);
    
    // Записываем использование промокода
    await pool.query(
      'INSERT INTO promocode_uses (user_id, promocode_id) VALUES ($1, $2)',
      [userId, promoData.id]
    );
    
    // Увеличиваем счетчик использований
    await pool.query(
      'UPDATE promocodes SET used_count = used_count + 1 WHERE id = $1',
      [promoData.id]
    );
    
    const remaining = promoData.max_uses - promoData.used_count - 1;
    
    return { 
      success: true, 
      message: `✅ **Промокод активирован!**\n\n⭐ Премиум-доступ навсегда активирован!\n\nОсталось активаций: ${remaining}` 
    };
    
  } catch (err) {
    console.error('❌ Ошибка активации промокода:', err);
    return { success: false, message: '❌ Ошибка активации промокода' };
  }
}

// ==================== ПРЕМИУМ ====================
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
    // Информация о промокоде
    const promoInfo = await pool.query('SELECT used_count, max_uses FROM promocodes WHERE code = $1', ['VIP40']);
    const used = promoInfo.rows[0]?.used_count || 0;
    const max = promoInfo.rows[0]?.max_uses || 40;
    const remaining = max - used;
    
    await ctx.reply(
      `⭐ **Премиум-доступ**\n\n` +
      `**Что дает премиум:**\n` +
      `• 📊 Расширенная статистика\n` +
      `• 📈 Бюджеты и лимиты\n` +
      `• 📉 Прогнозы и аналитика\n` +
      `• 📎 Экспорт в Excel\n` +
      `• 🔔 Уведомления\n\n` +
      `🎫 **Промокод VIP40**\n` +
      `Осталось активаций: ${remaining}/40\n` +
      `Активируй и получи премиум НАВСЕГДА бесплатно!`,
      { parse_mode: 'Markdown', ...mainMenu }
    );
  }
}

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
        text === '🎫 Промокод' ||
        text === '📋 Мои записи' ||
        text === '❓ Помощь' ||
        text === '🔙 В главное меню') {
      return;
    }
    
    // Обработка промокода
    if (state === 'waiting_promo') {
      const result = await activatePromo(userId, text.trim().toUpperCase());
      userStates.delete(userId);
      await ctx.reply(result.message, { parse_mode: 'Markdown' });
      await ctx.reply('Главное меню:', mainMenu);
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
    
    // Определяем тип
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
    
    // Очищаем состояние и возвращаем в меню
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
  console.log('🎫 Промокод VIP40 - премиум навсегда для 40 человек');
}

startBot().catch(err => {
  console.error('❌ Ошибка запуска бота:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));