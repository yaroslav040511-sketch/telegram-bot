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
    
    // Таблица целей (премиум)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(100) NOT NULL,
        target_amount DECIMAL(10,2) NOT NULL,
        current_amount DECIMAL(10,2) DEFAULT 0,
        deadline DATE,
        completed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Таблица челленджей (премиум)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS challenges (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(100) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        completed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Таблица достижений (премиум)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(100) NOT NULL,
        earned_at TIMESTAMP DEFAULT NOW()
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

// ==================== ПРОВЕРКА ПРЕМИУМ ДЛЯ КОМАНД ====================
async function checkPremium(ctx, commandName) {
  const userId = ctx.from.id;
  const isUserPremium = await isPremium(userId);
  
  if (!isUserPremium) {
    await ctx.reply(
      `❌ **Эта функция доступна только в премиум-версии!**\n\n` +
      `⭐ Премиум дает:\n` +
      `• 📈 Графики и диаграммы\n` +
      `• 🎯 Цели и накопления\n` +
      `• 🤖 AI-советы\n` +
      `• 🏆 Челленджи и достижения\n` +
      `• 📅 Умные напоминания\n\n` +
      `💎 **100 Telegram Stars в месяц**\n` +
      `🎫 Промокод VIP40 - премиум навсегда для 40 человек!`,
      { parse_mode: 'Markdown' }
    );
    return false;
  }
  return true;
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

// Главное меню (бесплатные функции)
const mainMenu = Markup.keyboard([
  ['💰 Добавить доход', '💸 Добавить расход'],
  ['📊 Статистика', '📋 Мои записи'],
  ['⭐ Премиум функции', '🎫 Промокод'],
  ['❓ Помощь']
]).resize();

// Премиум меню (платные функции)
const premiumMenu = Markup.keyboard([
  ['📈 Графики', '🎯 Цели'],
  ['🤖 AI совет', '🏆 Челленджи'],
  ['📅 Напоминания', '⭐ Статус'],
  ['🔙 В главное меню']
]).resize();

// Кнопка отмены
const backToMenu = Markup.keyboard(['🔙 В главное меню']).resize();

// Состояния пользователей
const userStates = new Map();

// ==================== КОМАНДЫ ====================

// СТАРТ
bot.start(async (ctx) => {
  const welcome = `
👋 Привет! Я твой **финансовый помощник**!

📝 **Бесплатные функции:**
• Запись доходов/расходов
• Просмотр последних записей
• Базовая статистика

⭐ **Премиум функции:**
• 📈 Графики и диаграммы
• 🎯 Цели и накопления
• 🤖 AI-советы по финансам
• 🏆 Челленджи и достижения
• 📅 Умные напоминания

🎫 **Промокод VIP40** - премиум навсегда для 40 человек!

⬇️ Используй кнопки ниже ⬇️
  `;
  
  await ctx.reply(welcome, { parse_mode: 'Markdown' });
  await ctx.reply('Главное меню:', mainMenu);
  console.log(`👋 Новый пользователь: ${ctx.from.id} (@${ctx.from.username || 'no username'})`);
});

// ПОМОЩЬ
bot.command('help', async (ctx) => {
  await showHelp(ctx);
});

async function showHelp(ctx) {
  const help = `
📚 **Доступные команды:**

🆓 **Бесплатные:**
• Просто пиши сумму и описание
  Пример: "500 зарплата"
  Пример: "кофе 300"
• /stats - базовая статистика
• /my - последние записи

⭐ **Премиум:**
• /graph - графики
• /goal - цели
• /advice - AI совет
• /challenge - челленджи
• /remind - напоминания

🎫 **Промокоды:**
/promo - активировать промокод
  `;
  
  await ctx.reply(help, { parse_mode: 'Markdown' });
}

// Возврат в главное меню
bot.hears('🔙 В главное меню', async (ctx) => {
  userStates.delete(ctx.from.id);
  await ctx.reply('Главное меню:', mainMenu);
});

// ==================== БЕСПЛАТНЫЕ ФУНКЦИИ ====================

// Добавить доход
bot.hears('💰 Добавить доход', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_income');
  await ctx.reply('Напиши сумму и описание дохода (например: "50000 зарплата")', backToMenu);
});

// Добавить расход
bot.hears('💸 Добавить расход', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_expense');
  await ctx.reply('Напиши сумму и описание расхода (например: "кофе 300" или "-300 такси")', backToMenu);
});

// Статистика (бесплатно)
bot.hears('📊 Статистика', async (ctx) => {
  await showBasicStats(ctx);
});

bot.command('stats', async (ctx) => {
  await showBasicStats(ctx);
});

async function showBasicStats(ctx) {
  try {
    const userId = ctx.from.id;
    
    const incomes = await pool.query(`
      SELECT 
        SUM(amount) as total,
        COUNT(*) as count
      FROM transactions 
      WHERE user_id = $1 AND type = 'income'
    `, [userId]);
    
    const expenses = await pool.query(`
      SELECT 
        category,
        SUM(amount) as total
      FROM transactions 
      WHERE user_id = $1 AND type = 'expense'
      GROUP BY category
      ORDER BY total DESC
      LIMIT 5
    `, [userId]);
    
    const totalIncome = parseFloat(incomes.rows[0]?.total || 0);
    const totalExpense = expenses.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    
    let message = `📊 **Базовая статистика:**\n\n`;
    message += `💰 Доходы: ${totalIncome.toFixed(2)}₽\n`;
    message += `💸 Расходы: ${totalExpense.toFixed(2)}₽\n`;
    message += `💵 Баланс: ${(totalIncome - totalExpense).toFixed(2)}₽\n\n`;
    
    if (expenses.rows.length > 0) {
      message += '📌 **Топ категории:**\n';
      expenses.rows.forEach(row => {
        message += `  ${row.category}: ${parseFloat(row.total).toFixed(2)}₽\n`;
      });
    }
    
    message += `\n⭐ **Хочешь больше?** Премиум дает графики, цели и AI-советы!`;
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (err) {
    console.error('❌ Ошибка статистики:', err);
    ctx.reply('❌ Ошибка получения статистики');
  }
}

// Мои записи (бесплатно)
bot.hears('📋 Мои записи', async (ctx) => {
  await showMyRecords(ctx);
});

bot.command('my', async (ctx) => {
  await showMyRecords(ctx);
});

async function showMyRecords(ctx) {
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
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (err) {
    console.error('❌ Ошибка получения записей:', err);
    ctx.reply('❌ Ошибка получения записей');
  }
}

// ==================== ПРЕМИУМ ФУНКЦИИ ====================

// Меню премиум функций
bot.hears('⭐ Премиум функции', async (ctx) => {
  const userId = ctx.from.id;
  const premium = await isPremium(userId);
  
  if (premium) {
    await ctx.reply('⭐ **Премиум меню:**\nВыбери функцию:', premiumMenu);
  } else {
    await showPremiumInfo(ctx);
  }
});

// Информация о премиум
async function showPremiumInfo(ctx) {
  const promoInfo = await pool.query('SELECT used_count, max_uses FROM promocodes WHERE code = $1', ['VIP40']);
  const used = promoInfo.rows[0]?.used_count || 0;
  const max = promoInfo.rows[0]?.max_uses || 40;
  const remaining = max - used;
  
  const premiumKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💎 Купить за 100 Stars', 'buy_premium')]
  ]);
  
  await ctx.reply(
    `⭐ **Премиум-доступ**\n\n` +
    `**Что дает премиум:**\n` +
    `• 📈 Графики и диаграммы\n` +
    `• 🎯 Цели и накопления\n` +
    `• 🤖 Персональные AI-советы\n` +
    `• 🏆 Челленджи и достижения\n` +
    `• 📅 Умные напоминания\n\n` +
    `**Стоимость:** 100 Telegram Stars в месяц\n\n` +
    `🎫 **Промокод VIP40**\n` +
    `Осталось активаций: ${remaining}/40\n` +
    `Активируй и получи премиум НАВСЕГДА бесплатно!`,
    { parse_mode: 'Markdown', ...premiumKeyboard }
  );
}

// Графики (премиум)
bot.hears('📈 Графики', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'graph')) return;
  
  // Здесь будет код для генерации графиков
  await ctx.reply(
    `📈 **Функция графиков**\n\n` +
    `Скоро здесь будут:\n` +
    `• Круговая диаграмма расходов\n` +
    `• График трат по дням\n` +
    `• Сравнение доходов/расходов\n\n` +
    `Разработка в процессе... 🚀`
  );
});

// Цели (премиум)
bot.hears('🎯 Цели', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'goals')) return;
  
  userStates.set(ctx.from.id, 'waiting_goal');
  await ctx.reply(
    '🎯 **Создание цели**\n\n' +
    'Напиши в формате:\n' +
    'цель:Название,сумма,дата\n\n' +
    'Пример: цель:iPhone 15,100000,2024-12-31',
    backToMenu
  );
});

// AI совет (премиум)
bot.hears('🤖 AI совет', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'advice')) return;
  
  // Получаем данные пользователя
  const expenses = await pool.query(`
    SELECT category, SUM(amount) as total
    FROM transactions 
    WHERE user_id = $1 AND type = 'expense' AND date > NOW() - INTERVAL '30 days'
    GROUP BY category
    ORDER BY total DESC
    LIMIT 3
  `, [userId]);
  
  let advice = '🤖 **AI-анализ ваших трат:**\n\n';
  
  if (expenses.rows.length > 0) {
    expenses.rows.forEach(row => {
      if (row.category === '🍔 Еда') {
        advice += `• В этом месяце на еду потрачено ${parseFloat(row.total).toFixed(2)}₽. Попробуй готовить дома чаще!\n`;
      } else if (row.category === '🚗 Транспорт') {
        advice += `• Транспорт: ${parseFloat(row.total).toFixed(2)}₽. Может, стоит купить проездной?\n`;
      } else if (row.category === '🎮 Развлечения') {
        advice += `• Развлечения: ${parseFloat(row.total).toFixed(2)}₽. Не забывай отдыхать, но знай меру 😉\n`;
      }
    });
  } else {
    advice += '• Пока недостаточно данных для анализа. Добавь больше трат!\n';
  }
  
  await ctx.reply(advice);
});

// Челленджи (премиум)
bot.hears('🏆 Челленджи', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'challenges')) return;
  
  const challengesKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🚫 Неделя без кофе', 'challenge_nocoffee')],
    [Markup.button.callback('🍔 Месяц без фастфуда', 'challenge_nofastfood')],
    [Markup.button.callback('💰 Накопить 5000₽', 'challenge_save')]
  ]);
  
  await ctx.reply(
    '🏆 **Доступные челленджи:**\n\n' +
    '• 🚫 Неделя без кофе\n' +
    '• 🍔 Месяц без фастфуда\n' +
    '• 💰 Накопить 5000₽ за неделю\n\n' +
    'Выбери челлендж:',
    challengesKeyboard
  );
});

// Напоминания (премиум)
bot.hears('📅 Напоминания', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'reminders')) return;
  
  await ctx.reply(
    '📅 **Напоминания**\n\n' +
    'Функция в разработке. Здесь можно будет настроить:\n' +
    '• Ежедневный отчет о тратах\n' +
    '• Напоминания о регулярных платежах\n' +
    '• Уведомления о превышении бюджета'
  );
});

// Статус премиум
bot.hears('⭐ Статус', async (ctx) => {
  const userId = ctx.from.id;
  const premium = await isPremium(userId);
  
  if (premium) {
    const result = await pool.query('SELECT valid_until FROM premium_users WHERE user_id = $1', [userId]);
    const validUntil = new Date(result.rows[0].valid_until).toLocaleDateString('ru-RU');
    
    await ctx.reply(
      `⭐ **Премиум статус:** АКТИВЕН\n\n` +
      `✅ Действует до: ${validUntil}\n` +
      `✅ Все премиум функции доступны`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(
      `❌ **Премиум статус:** НЕ АКТИВЕН\n\n` +
      `Приобрети премиум или активируй промокод VIP40!`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ==================== ПРОМОКОДЫ ====================
bot.hears('🎫 Промокод', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_promo');
  await ctx.reply('🎫 Введите промокод:', backToMenu);
});

bot.command('promo', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_promo');
  await ctx.reply('🎫 Введите промокод:', backToMenu);
});

async function activatePromo(userId, promoCode) {
  try {
    const usedCheck = await pool.query(`
      SELECT pu.*, p.code FROM promocode_uses pu
      JOIN promocodes p ON pu.promocode_id = p.id
      WHERE pu.user_id = $1 AND p.code = $2
    `, [userId, promoCode]);
    
    if (usedCheck.rows.length > 0) {
      return { success: false, message: '❌ Вы уже активировали этот промокод' };
    }
    
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
    
    await activatePremium(userId, 9999);
    
    await pool.query(
      'INSERT INTO promocode_uses (user_id, promocode_id) VALUES ($1, $2)',
      [userId, promoData.id]
    );
    
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
        text === '📋 Мои записи' ||
        text === '⭐ Премиум функции' ||
        text === '🎫 Промокод' ||
        text === '❓ Помощь' ||
        text === '🔙 В главное меню' ||
        text === '📈 Графики' ||
        text === '🎯 Цели' ||
        text === '🤖 AI совет' ||
        text === '🏆 Челленджи' ||
        text === '📅 Напоминания' ||
        text === '⭐ Статус') {
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
    
    // Обработка цели
    if (state === 'waiting_goal') {
      if (!await isPremium(userId)) {
        await ctx.reply('❌ Это премиум функция!', mainMenu);
        userStates.delete(userId);
        return;
      }
      
      try {
        const parts = text.split(',');
        const name = parts[0].replace('цель:', '').trim();
        const amount = parseFloat(parts[1]);
        const date = parts[2].trim();
        
        await pool.query(
          'INSERT INTO goals (user_id, name, target_amount, deadline) VALUES ($1, $2, $3, $4)',
          [userId, name, amount, date]
        );
        
        await ctx.reply(`✅ Цель "${name}" создана! Удачи! 🎯`);
      } catch (err) {
        await ctx.reply('❌ Неправильный формат. Используй: цель:Название,сумма,дата');
      }
      
      userStates.delete(userId);
      await ctx.reply('Главное меню:', mainMenu);
      return;
    }
    
    // Обычная запись дохода/расхода
    console.log(`📨 Сообщение от ${userId}: "${text}"`);
    
    const match = text.match(/(-?\d+[\d\s]*[\d,.]*|\d+[\d\s]*[\d,.]*)/);
    if (!match) {
      await ctx.reply('❌ Не могу найти сумму. Пример: "500 зарплата" или "кофе 300"', backToMenu);
      return;
    }
    
    let amount = parseFloat(match[0].replace(/\s/g, '').replace(',', '.'));
    const description = text.replace(match[0], '').trim() || 'без описания';
    
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
    
    userStates.delete(userId);
    await ctx.reply('Что делаем дальше?', mainMenu);
    
  } catch (err) {
    console.error('❌ Ошибка обработки сообщения:', err);
    ctx.reply('❌ Произошла ошибка. Попробуй еще раз.', mainMenu);
  }
});

// ==================== ОБРАБОТКА КНОПОК ЧЕЛЛЕНДЖЕЙ ====================
bot.action(/challenge_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  if (!await isPremium(userId)) {
    await ctx.answerCbQuery('❌ Это премиум функция!', { show_alert: true });
    return;
  }
  
  const challenge = ctx.match[1];
  let response = '';
  
  switch(challenge) {
    case 'nocoffee':
      response = '✅ Челлендж "Неделя без кофе" активирован! Удачи! ☕🚫';
      break;
    case 'nofastfood':
      response = '✅ Челлендж "Месяц без фастфуда" активирован! Будь здоров! 🍔🚫';
      break;
    case 'save':
      response = '✅ Челлендж "Накопить 5000₽ за неделю" активирован! Вперед! 💰';
      break;
  }
  
  await ctx.answerCbQuery();
  await ctx.reply(response);
});

// ==================== ПОКУПКА ПРЕМИУМ ====================
bot.action('buy_premium', async (ctx) => {
  await ctx.answerCbQuery();
  
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

bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on('successful_payment', async (ctx) => {
  const userId = ctx.from.id;
  
  await pool.query(
    'INSERT INTO premium_users (user_id, valid_until) VALUES ($1, NOW() + INTERVAL \'30 days\') ON CONFLICT (user_id) DO UPDATE SET valid_until = NOW() + INTERVAL \'30 days\'',
    [userId]
  );
  
  await ctx.reply(
    '✅ **Оплата прошла успешно!**\n\n' +
    '⭐ Премиум-доступ активирован на 30 дней.\n' +
    'Все премиум функции теперь доступны!',
    { parse_mode: 'Markdown' }
  );
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