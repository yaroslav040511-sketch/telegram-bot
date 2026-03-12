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
    
    // Добавляем колонку chat_mode если её нет
    try {
      await pool.query(`
        ALTER TABLE premium_users ADD COLUMN IF NOT EXISTS chat_mode VARCHAR(20) DEFAULT 'normal'
      `);
      console.log('✅ Колонка chat_mode добавлена или уже существует');
    } catch (err) {
      console.log('⚠️ Ошибка при добавлении колонки chat_mode:', err.message);
    }
    
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

// ==================== ПОЛУЧЕНИЕ РЕЖИМА ЧАТА (БЕЗОПАСНАЯ ВЕРСИЯ) ====================
async function getChatMode(userId) {
  try {
    // Проверяем, является ли пользователь премиум
    const isUserPremium = await isPremium(userId);
    if (!isUserPremium) return 'normal';
    
    // Пробуем получить режим
    try {
      const result = await pool.query(
        'SELECT chat_mode FROM premium_users WHERE user_id = $1',
        [userId]
      );
      if (result.rows.length > 0 && result.rows[0].chat_mode) {
        return result.rows[0].chat_mode;
      }
    } catch (err) {
      // Если колонки нет - пробуем добавить
      if (err.code === '42703') {
        console.log('⚠️ Колонка chat_mode отсутствует, добавляем...');
        try {
          await pool.query('ALTER TABLE premium_users ADD COLUMN IF NOT EXISTS chat_mode VARCHAR(20) DEFAULT \'normal\'');
          console.log('✅ Колонка chat_mode успешно добавлена');
        } catch (alterErr) {
          console.error('❌ Не удалось добавить колонку:', alterErr.message);
        }
      }
    }
    return 'normal';
  } catch (err) {
    console.error('Ошибка получения режима:', err);
    return 'normal';
  }
}

// ==================== УСТАНОВКА РЕЖИМА ЧАТА (БЕЗОПАСНАЯ ВЕРСИЯ) ====================
async function setChatMode(userId, mode) {
  try {
    // Проверяем, является ли пользователь премиум
    const isUserPremium = await isPremium(userId);
    if (!isUserPremium) return false;
    
    // Пробуем обновить режим
    try {
      await pool.query(
        'UPDATE premium_users SET chat_mode = $1 WHERE user_id = $2',
        [mode, userId]
      );
      console.log(`✅ Режим для user ${userId} установлен на ${mode}`);
      return true;
    } catch (err) {
      // Если колонки нет - добавляем и пробуем снова
      if (err.code === '42703') {
        console.log('⚠️ Колонка chat_mode отсутствует, добавляем...');
        try {
          await pool.query('ALTER TABLE premium_users ADD COLUMN IF NOT EXISTS chat_mode VARCHAR(20) DEFAULT \'normal\'');
          // Пробуем снова
          await pool.query(
            'UPDATE premium_users SET chat_mode = $1 WHERE user_id = $2',
            [mode, userId]
          );
          console.log(`✅ Режим для user ${userId} установлен на ${mode}`);
          return true;
        } catch (alterErr) {
          console.error('❌ Не удалось добавить колонку:', alterErr.message);
          return false;
        }
      }
      throw err;
    }
  } catch (err) {
    console.error('Ошибка установки режима:', err);
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
      `• 😈 Смешной режим с матом\n\n` +
      `💎 **100 Telegram Stars в месяц**\n` +
      `🎫 Промокод VIP40 - премиум навсегда для 40 человек!`,
      { parse_mode: 'Markdown' }
    );
    return false;
  }
  return true;
}

// ==================== ГЕНЕРАЦИЯ ТЕКСТА В ЗАВИСИМОСТИ ОТ РЕЖИМА ====================
async function formatResponse(ctx, normalText, rudeText) {
  const userId = ctx.from.id;
  const mode = await getChatMode(userId);
  
  if (mode === 'rude') {
    return rudeText;
  } else {
    return normalText;
  }
}

// ==================== АКТИВАЦИЯ ПРЕМИУМ ====================
async function activatePremium(userId, days = 9999) {
  try {
    await pool.query(
      'INSERT INTO premium_users (user_id, valid_until, chat_mode) VALUES ($1, NOW() + $2::interval, $3) ON CONFLICT (user_id) DO UPDATE SET valid_until = NOW() + $2::interval',
      [userId, `${days} days`, 'normal']
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

// Премиум меню
const premiumMenu = Markup.keyboard([
  ['📈 Графики', '🎯 Цели'],
  ['🤖 AI совет', '🏆 Челленджи'],
  ['😈 Режим общения', '⭐ Статус'],
  ['🔙 В главное меню']
]).resize();

// Меню выбора режима
const modeMenu = Markup.inlineKeyboard([
  [Markup.button.callback('😇 Обычный (вежливый)', 'mode_normal')],
  [Markup.button.callback('😈 Смешной (с матом)', 'mode_rude')],
  [Markup.button.callback('🔙 Назад', 'back_to_premium')]
]);

// Кнопка отмены
const backToMenu = Markup.keyboard(['🔙 В главное меню']).resize();

// Состояния пользователей
const userStates = new Map();

// ==================== КОМАНДЫ ====================

// СТАРТ - ИСПРАВЛЕННАЯ ВЕРСИЯ
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  
  // Получаем режим из базы
  const mode = await getChatMode(userId);
  
  console.log(`🚀 Старт для user ${userId}, режим: ${mode}`);
  
  if (mode === 'rude') {
    const welcome = `👋 Здарова, нищеброд!

Я твой финансовый помощник, бля. Буду считать твои копейки, чтоб ты не проебывал всё до зарплаты.

📝 Че по функциям:
• Пиши "5000 зарплата" - хуй знает, может хватит до получки
• Пиши "-300 кофе" - опять проебал бабки на хуйню
• Пиши "такси 500" - пешком ходи, пидор!

🎫 Промокод VIP40 - ебашь сюда, получишь премиум навечно (пока я не передумал)

⬇️ Жми кнопки, лох ⬇️`;
    await ctx.reply(welcome);
  } else {
    const welcome = `👋 Привет! Я твой финансовый помощник!

📝 Как записывать:
• "500 зарплата" - доход
• "кофе 300" - расход
• "такси 500" - расход

🎫 Промокод VIP40 - премиум навсегда для 40 человек!

⬇️ Используй кнопки ниже ⬇️`;
    await ctx.reply(welcome, { parse_mode: 'Markdown' });
  }
  
  await ctx.reply('Главное меню:', mainMenu);
  console.log(`👋 Новый пользователь: ${ctx.from.id} (@${ctx.from.username || 'no username'})`);
});

// ПОМОЩЬ
bot.command('help', async (ctx) => {
  await showHelp(ctx);
});

async function showHelp(ctx) {
  const userId = ctx.from.id;
  const mode = await getChatMode(userId);
  
  if (mode === 'rude') {
    await ctx.reply(`❓ Че надо, бля?

Команды:
/start - хули, заново начать
/stats - смотри куда проебал бабки
/my - последние траты (порыдать)
/premium - узнай как стать богаче
/mode - проверить текущий режим

Промокод: VIP40 (ебашь, пока не закрыли)`);
  } else {
    await ctx.reply(`📚 Доступные команды:

/stats - статистика
/my - последние записи
/premium - премиум функции
/promo - активировать промокод
/mode - текущий режим

🎫 Промокод VIP40 - премиум навсегда!`);
  }
}

// Команда для проверки режима
bot.command('mode', async (ctx) => {
  const userId = ctx.from.id;
  const mode = await getChatMode(userId);
  const isUserPremium = await isPremium(userId);
  
  if (!isUserPremium) {
    await ctx.reply('❌ Эта команда только для премиум пользователей!');
    return;
  }
  
  const modeText = mode === 'rude' ? '😈 Смешной (с матом)' : '😇 Обычный (вежливый)';
  await ctx.reply(`Текущий режим: ${modeText}`);
});

// Возврат в главное меню
bot.hears('🔙 В главное меню', async (ctx) => {
  userStates.delete(ctx.from.id);
  await ctx.reply('Главное меню:', mainMenu);
});

// ==================== БЕСПЛАТНЫЕ ФУНКЦИИ ====================

// Добавить доход
bot.hears('💰 Добавить доход', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_income');
  const userId = ctx.from.id;
  const mode = await getChatMode(userId);
  
  if (mode === 'rude') {
    await ctx.reply('Пиши сумму и че за бабки (например: "50000 зарплата")', backToMenu);
  } else {
    await ctx.reply('Напиши сумму и описание дохода (например: "50000 зарплата")', backToMenu);
  }
});

// Добавить расход
bot.hears('💸 Добавить расход', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_expense');
  const userId = ctx.from.id;
  const mode = await getChatMode(userId);
  
  if (mode === 'rude') {
    await ctx.reply('Пиши на что проебал бабки (например: "кофе 300" или "-300 такси")', backToMenu);
  } else {
    await ctx.reply('Напиши сумму и описание расхода (например: "кофе 300" или "-300 такси")', backToMenu);
  }
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
    const mode = await getChatMode(userId);
    
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
    
    if (mode === 'rude') {
      let message = `📊 Смотри сюда, нищеброд, куда ты проебал бабки:\n\n`;
      message += `💰 Заработал: ${totalIncome.toFixed(0)}₽\n`;
      message += `💸 Проебал: ${totalExpense.toFixed(0)}₽\n`;
      message += `💵 Осталось: ${(totalIncome - totalExpense).toFixed(0)}₽\n\n`;
      
      if (expenses.rows.length > 0) {
        message += '📌 Куда улетели бабки:\n';
        expenses.rows.forEach(row => {
          let comment = '';
          if (row.category.includes('🍔 Еда')) comment = '(много жрешь, бля!)';
          else if (row.category.includes('🚗 Транспорт')) comment = '(пешком ходи, пидор!)';
          else if (row.category.includes('🎮 Развлечения')) comment = '(хватит дрочить в танки!)';
          message += `  ${row.category}: ${parseFloat(row.total).toFixed(0)}₽ ${comment}\n`;
        });
      }
      
      message += `\n⭐ Хочешь больше? Премиум дает графики, цели и смешной режим!`;
      await ctx.reply(message);
    } else {
      let message = `📊 **Базовая статистика:**\n\n`;
      message += `💰 Доходы: ${totalIncome.toFixed(0)}₽\n`;
      message += `💸 Расходы: ${totalExpense.toFixed(0)}₽\n`;
      message += `💵 Баланс: ${(totalIncome - totalExpense).toFixed(0)}₽\n\n`;
      
      if (expenses.rows.length > 0) {
        message += '📌 **Топ категории:**\n';
        expenses.rows.forEach(row => {
          message += `  ${row.category}: ${parseFloat(row.total).toFixed(0)}₽\n`;
        });
      }
      
      message += `\n⭐ Хочешь больше? Премиум дает графики, цели и AI-советы!`;
      await ctx.reply(message, { parse_mode: 'Markdown' });
    }
    
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
    const mode = await getChatMode(userId);
    
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC LIMIT 10',
      [userId]
    );
    
    if (result.rows.length === 0) {
      if (mode === 'rude') {
        return ctx.reply('📋 У тебя ещё нет записей, лох! Добавь что-нибудь', mainMenu);
      } else {
        return ctx.reply('📋 У вас пока нет записей', mainMenu);
      }
    }
    
    let message = mode === 'rude' ? '📋 Последние 10 проёбов:\n\n' : '📋 **Последние 10 записей:**\n\n';
    
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
    `• 😈 Выбор режима общения (с матом или без)\n\n` +
    `**Стоимость:** 100 Telegram Stars в месяц\n\n` +
    `🎫 **Промокод VIP40**\n` +
    `Осталось активаций: ${remaining}/40\n` +
    `Активируй и получи премиум НАВСЕГДА бесплатно!`,
    { parse_mode: 'Markdown', ...premiumKeyboard }
  );
}

// Режим общения
bot.hears('😈 Режим общения', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'mode')) return;
  
  const currentMode = await getChatMode(userId);
  const modeText = currentMode === 'rude' ? 'смешной (с матом)' : 'обычный (вежливый)';
  
  await ctx.reply(
    `😈 **Режим общения**\n\n` +
    `Сейчас выбран: ${modeText}\n\n` +
    `Выбери как я буду с тобой разговаривать:`,
    modeMenu
  );
});

// Обработка выбора режима
bot.action('mode_normal', async (ctx) => {
  const userId = ctx.from.id;
  const success = await setChatMode(userId, 'normal');
  
  if (success) {
    await ctx.answerCbQuery('✅ Выбран обычный режим');
    await ctx.editMessageText(
      '😇 **Режим изменён**\n\nТеперь я буду общаться с тобой вежливо и культурно.\n\nНажми /start чтобы увидеть изменения!',
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.answerCbQuery('❌ Ошибка при смене режима');
  }
});

bot.action('mode_rude', async (ctx) => {
  const userId = ctx.from.id;
  const success = await setChatMode(userId, 'rude');
  
  if (success) {
    await ctx.answerCbQuery('✅ Выбран смешной режим');
    await ctx.editMessageText(
      '😈 **Режим изменён, бля!**\n\nТеперь я буду с тобой по-пацански разговаривать, с матюками и приколами.\n\nНажми /start чтоб увидеть изменения, лох!',
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.answerCbQuery('❌ Ошибка при смене режима');
  }
});

bot.action('back_to_premium', async (ctx) => {
  await ctx.deleteMessage();
  await ctx.reply('⭐ **Премиум меню:**\nВыбери функцию:', premiumMenu);
});

// Статус премиум
bot.hears('⭐ Статус', async (ctx) => {
  const userId = ctx.from.id;
  const premium = await isPremium(userId);
  const mode = await getChatMode(userId);
  const modeText = mode === 'rude' ? 'смешной (с матом)' : 'обычный (вежливый)';
  
  if (premium) {
    const result = await pool.query('SELECT valid_until FROM premium_users WHERE user_id = $1', [userId]);
    const validUntil = new Date(result.rows[0].valid_until).toLocaleDateString('ru-RU');
    
    await ctx.reply(
      `⭐ **Премиум статус:** АКТИВЕН\n\n` +
      `✅ Действует до: ${validUntil}\n` +
      `✅ Режим общения: ${modeText}\n` +
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

// AI совет (премиум)
bot.hears('🤖 AI совет', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'advice')) return;
  const mode = await getChatMode(userId);
  
  try {
    const expenses = await pool.query(`
      SELECT category, SUM(amount) as total
      FROM transactions 
      WHERE user_id = $1 AND type = 'expense'
      GROUP BY category
      ORDER BY total DESC
    `, [userId]);
    
    const incomes = await pool.query(`
      SELECT SUM(amount) as total
      FROM transactions 
      WHERE user_id = $1 AND type = 'income'
    `, [userId]);
    
    const totalIncome = parseFloat(incomes.rows[0]?.total || 0);
    const totalExpense = expenses.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    
    if (expenses.rows.length === 0) {
      if (mode === 'rude') {
        await ctx.reply('🤖 Ебать, у тебя даже трат нет! Живёшь на халяву или бомжуешь? Добавь что-нибудь, лох!');
      } else {
        await ctx.reply('🤖 У вас пока нет данных для анализа. Добавьте несколько трат!');
      }
      return;
    }
    
    if (mode === 'rude') {
      let advice = `🤖 Сейчас я, бля, посмотрю твои траты...\n\n`;
      
      expenses.rows.forEach(row => {
        const amount = parseFloat(row.total);
        if (row.category.includes('🍔 Еда') && amount > 10000) {
          advice += `💡 О, ебать! Ты проебал ${amount.toFixed(0)}₽ на жратву! Иди готовь сам, пидор, а не в рестики ходи!\n\n`;
        } else if (row.category.includes('🚗 Транспорт') && amount > 5000) {
          advice += `💡 Такси на ${amount.toFixed(0)}₽ - пешком ходи, лох! Маршрутка дешевле, бля!\n\n`;
        } else if (row.category.includes('🎮 Развлечения') && amount > 5000) {
          advice += `💡 ${amount.toFixed(0)}₽ на игры? Хватит дрочить, иди работай!\n\n`;
        }
      });
      
      advice += `🎯 Короче, экономить надо, пидор. Ща посчитал - мог бы ${(totalExpense * 0.2).toFixed(0)}₽ сэкономить, если б не был лохом!`;
      
      await ctx.reply(advice);
    } else {
      let advice = `🤖 **AI-анализ ваших финансов:**\n\n`;
      
      if (totalIncome > 0) {
        advice += `💰 Доход: ${totalIncome.toFixed(0)}₽\n`;
        advice += `💸 Расход: ${totalExpense.toFixed(0)}₽\n`;
        advice += `📊 Накопления: ${(totalIncome - totalExpense).toFixed(0)}₽\n\n`;
      }
      
      advice += `📌 **Рекомендации:**\n`;
      expenses.rows.forEach(row => {
        const amount = parseFloat(row.total);
        if (row.category.includes('🍔 Еда') && amount > 10000) {
          advice += `• Постарайтесь сократить расходы на еду, готовьте дома чаще\n`;
        } else if (row.category.includes('🚗 Транспорт') && amount > 5000) {
          advice += `• Рассмотрите возможность использования общественного транспорта\n`;
        }
      });
      
      await ctx.reply(advice);
    }
    
  } catch (err) {
    console.error('❌ Ошибка AI анализа:', err);
    ctx.reply('❌ Ошибка при анализе данных');
  }
});// ==================== ПРЕМИУМ ФУНКЦИИ ====================

// ... (существующий код до AI совета)

// Графики (премиум)
bot.hears('📈 Графики', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'graph')) return;
  const mode = await getChatMode(userId);
  
  try {
    // Получаем данные для графиков
    const expenses = await pool.query(`
      SELECT category, SUM(amount) as total
      FROM transactions 
      WHERE user_id = $1 AND type = 'expense'
      GROUP BY category
      ORDER BY total DESC
    `, [userId]);
    
    const incomes = await pool.query(`
      SELECT SUM(amount) as total
      FROM transactions 
      WHERE user_id = $1 AND type = 'income'
    `, [userId]);
    
    const totalIncome = parseFloat(incomes.rows[0]?.total || 0);
    const totalExpense = expenses.rows.reduce((sum, row) => sum + parseFloat(row.total), 0);
    
    if (expenses.rows.length === 0 && totalIncome === 0) {
      if (mode === 'rude') {
        await ctx.reply('📈 Ебать, у тебя даже данных нет! Добавь что-нибудь, лох!');
      } else {
        await ctx.reply('📈 У вас пока нет данных для графиков. Добавьте несколько трат!');
      }
      return;
    }
    
    // Формируем текстовый график
    let message = mode === 'rude' 
      ? '📈 **ГРАФИКИ ТВОИХ ПРОЁБОВ, ПИДОР!**\n\n' 
      : '📈 **Визуализация расходов:**\n\n';
    
    message += `💰 Доходы: ${totalIncome.toFixed(0)}₽\n`;
    message += `💸 Расходы: ${totalExpense.toFixed(0)}₽\n`;
    message += `💵 Баланс: ${(totalIncome - totalExpense).toFixed(0)}₽\n\n`;
    
    if (expenses.rows.length > 0) {
      message += mode === 'rude' ? '📊 **Куда улетело:**\n' : '📊 **Распределение расходов:**\n';
      
      expenses.rows.forEach(row => {
        const amount = parseFloat(row.total);
        const percent = ((amount / totalExpense) * 100).toFixed(1);
        const barLength = Math.floor(percent / 5);
        const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
        
        message += `${row.category}:\n`;
        message += `   ${amount.toFixed(0)}₽ (${percent}%)\n`;
        message += `   ${bar}\n`;
      });
    }
    
    if (mode === 'rude') {
      message += `\n🎯 **Вывод:** ${totalIncome - totalExpense > 0 ? 'Не всё проебал, молодец!' : 'Ты в минусе, пидор! Срочно работай!'}`;
    }
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
    
  } catch (err) {
    console.error('❌ Ошибка графиков:', err);
    ctx.reply('❌ Ошибка при создании графиков');
  }
});

// Цели (премиум)
bot.hears('🎯 Цели', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'goals')) return;
  const mode = await getChatMode(userId);
  
  // Показываем существующие цели
  try {
    const goals = await pool.query(`
      SELECT * FROM goals 
      WHERE user_id = $1 AND completed = false 
      ORDER BY deadline ASC
    `, [userId]);
    
    if (goals.rows.length > 0) {
      let message = mode === 'rude' 
        ? '🎯 **ТВОИ ЦЕЛИ, ЛОХ!**\n\n' 
        : '🎯 **Ваши цели:**\n\n';
      
      goals.rows.forEach(goal => {
        const progress = (goal.current_amount / goal.target_amount * 100).toFixed(1);
        const barLength = Math.floor(progress / 5);
        const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
        
        message += `**${goal.name}**\n`;
        message += `   Цель: ${goal.target_amount}₽\n`;
        message += `   Накоплено: ${goal.current_amount}₽ (${progress}%)\n`;
        message += `   ${bar}\n`;
        message += `   Дедлайн: ${new Date(goal.deadline).toLocaleDateString('ru-RU')}\n\n`;
      });
      
      message += mode === 'rude' 
        ? '\n➕ Чтобы создать новую цель, напиши: цель:Название,сумма,дата\n   Например: цель:Айфон,100000,2024-12-31'
        : '\n➕ Создать новую цель: цель:Название,сумма,дата\n   Пример: цель:Айфон,100000,2024-12-31';
      
      await ctx.reply(message, { parse_mode: 'Markdown' });
    } else {
      if (mode === 'rude') {
        await ctx.reply(
          '🎯 У тебя ещё нет целей, лох!\n\n' +
          'Создай: цель:Название,сумма,дата\n' +
          'Нахуй: цель:Айфон,100000,2024-12-31'
        );
      } else {
        await ctx.reply(
          '🎯 У вас пока нет целей.\n\n' +
          'Создайте цель: цель:Название,сумма,дата\n' +
          'Пример: цель:Айфон,100000,2024-12-31'
        );
      }
    }
    
    // Устанавливаем состояние для создания цели
    userStates.set(ctx.from.id, 'waiting_goal');
    
  } catch (err) {
    console.error('❌ Ошибка получения целей:', err);
    ctx.reply('❌ Ошибка при получении целей');
  }
});

// Челленджи (премиум)
bot.hears('🏆 Челленджи', async (ctx) => {
  const userId = ctx.from.id;
  if (!await checkPremium(ctx, 'challenges')) return;
  const mode = await getChatMode(userId);
  
  const challengesKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🚫 Неделя без кофе', 'challenge_nocoffee')],
    [Markup.button.callback('🍔 Месяц без фастфуда', 'challenge_nofastfood')],
    [Markup.button.callback('💰 Накопить 5000₽', 'challenge_save')],
    [Markup.button.callback('🏃 Месяц спорта', 'challenge_sport')],
    [Markup.button.callback('📚 Прочитать книгу', 'challenge_book')]
  ]);
  
  if (mode === 'rude') {
    await ctx.reply(
      '🏆 **ЧЕЛЛЕНДЖИ ДЛЯ ЛОХОВ**\n\n' +
      'Выбери испытание и докажи, что ты не просто так яйца носишь!\n\n' +
      '• 🚫 Неделя без кофе - сэкономишь 2000₽\n' +
      '• 🍔 Месяц без фастфуда - сэкономишь 5000₽\n' +
      '• 💰 Накопить 5000₽ за неделю\n' +
      '• 🏃 Месяц спорта - бесплатно\n' +
      '• 📚 Прочитать книгу - развитие',
      challengesKeyboard
    );
  } else {
    await ctx.reply(
      '🏆 **Доступные челленджи:**\n\n' +
      'Выберите испытание для себя:\n\n' +
      '• 🚫 Неделя без кофе\n' +
      '• 🍔 Месяц без фастфуда\n' +
      '• 💰 Накопить 5000₽ за неделю\n' +
      '• 🏃 Месяц спорта\n' +
      '• 📚 Прочитать книгу',
      challengesKeyboard
    );
  }
});

// Обработка кнопок челленджей
bot.action(/challenge_(.+)/, async (ctx) => {
  const userId = ctx.from.id;
  if (!await isPremium(userId)) {
    await ctx.answerCbQuery('❌ Это премиум функция!', { show_alert: true });
    return;
  }
  
  const mode = await getChatMode(userId);
  const challenge = ctx.match[1];
  
  let response = '';
  let savings = 0;
  
  switch(challenge) {
    case 'nocoffee':
      savings = 2000;
      response = mode === 'rude' 
        ? '✅ Челлендж "Неделя без кофе" активирован!\n\nЕсли выдержишь - сэкономишь 2000₽. Не дрочи кофе, пидор! ☕🚫'
        : '✅ Челлендж "Неделя без кофе" активирован!\n\nЕсли выдержите - сэкономите около 2000₽. Удачи!';
      break;
    case 'nofastfood':
      savings = 5000;
      response = mode === 'rude'
        ? '✅ Челлендж "Месяц без фастфуда" активирован!\n\n5000₽ сэкономишь, лох! Готовь сам, не жри эту гадость! 🍔🚫'
        : '✅ Челлендж "Месяц без фастфуда" активирован!\n\nПотенциальная экономия: 5000₽. Будьте здоровы!';
      break;
    case 'save':
      response = mode === 'rude'
        ? '✅ Челлендж "Накопить 5000₽ за неделю" активирован!\n\nОткладывай по 715₽ в день, пидор, и будет тебе счастье! 💰'
        : '✅ Челлендж "Накопить 5000₽ за неделю" активирован!\n\nНужно откладывать по 715₽ в день. Вперёд!';
      break;
    case 'sport':
      response = mode === 'rude'
        ? '✅ Челлендж "Месяц спорта" активирован!\n\nХватит жопу пролеживать, иди качайся, лох! 🏃'
        : '✅ Челлендж "Месяц спорта" активирован!\n\nЗдоровье - это важно! Удачи!';
      break;
    case 'book':
      response = mode === 'rude'
        ? '✅ Челлендж "Прочитать книгу" активирован!\n\nРазвивайся, пидор, а то тупым помрёшь! 📚'
        : '✅ Челлендж "Прочитать книгу" активирован!\n\nСаморазвитие - лучшая инвестиция!';
      break;
  }
  
  // Сохраняем челлендж в базу
  try {
    const startDate = new Date();
    const endDate = new Date();
    
    if (challenge.includes('week') || challenge === 'nocoffee' || challenge === 'save') {
      endDate.setDate(endDate.getDate() + 7);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }
    
    await pool.query(
      'INSERT INTO challenges (user_id, name, start_date, end_date) VALUES ($1, $2, $3, $4)',
      [userId, challenge, startDate, endDate]
    );
    
  } catch (err) {
    console.error('Ошибка сохранения челленджа:', err);
  }
  
  await ctx.answerCbQuery();
  await ctx.reply(response);
  
  if (savings > 0 && mode === 'rude') {
    await ctx.reply(`💡 Кстати, если выполнишь - у тебя будет ${savings}₽ лишних. Не проеби их!`);
  }
});

// Просмотр активных челленджей
bot.command('mychallenges', async (ctx) => {
  const userId = ctx.from.id;
  if (!await isPremium(userId)) {
    await ctx.reply('❌ Эта команда только для премиум пользователей!');
    return;
  }
  
  const mode = await getChatMode(userId);
  
  try {
    const challenges = await pool.query(`
      SELECT * FROM challenges 
      WHERE user_id = $1 AND completed = false
      ORDER BY end_date ASC
    `, [userId]);
    
    if (challenges.rows.length === 0) {
      if (mode === 'rude') {
        await ctx.reply('🏆 У тебя нет активных челленджей, лох! Займись чем-нибудь!');
      } else {
        await ctx.reply('🏆 У вас нет активных челленджей. Начните новый в разделе "🏆 Челленджи"');
      }
      return;
    }
    
    let message = mode === 'rude' 
      ? '🏆 **ТВОИ ЧЕЛЛЕНДЖИ, ПИДОР!**\n\n' 
      : '🏆 **Ваши активные челленджи:**\n\n';
    
    challenges.rows.forEach(ch => {
      const endDate = new Date(ch.end_date).toLocaleDateString('ru-RU');
      const daysLeft = Math.ceil((new Date(ch.end_date) - new Date()) / (1000 * 60 * 60 * 24));
      
      let name = '';
      switch(ch.name) {
        case 'nocoffee': name = '🚫 Неделя без кофе'; break;
        case 'nofastfood': name = '🍔 Месяц без фастфуда'; break;
        case 'save': name = '💰 Накопить 5000₽'; break;
        case 'sport': name = '🏃 Месяц спорта'; break;
        case 'book': name = '📚 Прочитать книгу'; break;
        default: name = ch.name;
      }
      
      message += `${name}\n`;
      message += `   Дедлайн: ${endDate} (осталось ${daysLeft} дней)\n\n`;
    });
    
    await ctx.reply(message);
    
  } catch (err) {
    console.error('Ошибка получения челленджей:', err);
    ctx.reply('❌ Ошибка при получении челленджей');
  }
});

// ==================== ПРОМОКОДЫ ====================
bot.hears('🎫 Промокод', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_promo');
  const userId = ctx.from.id;
  const mode = await getChatMode(userId);
  
  if (mode === 'rude') {
    await ctx.reply('🎫 Вводи промокод, лох! (VIP40 например)', backToMenu);
  } else {
    await ctx.reply('🎫 Введите промокод:', backToMenu);
  }
});

bot.command('promo', async (ctx) => {
  userStates.set(ctx.from.id, 'waiting_promo');
  const userId = ctx.from.id;
  const mode = await getChatMode(userId);
  
  if (mode === 'rude') {
    await ctx.reply('🎫 Вводи промокод, лох! (VIP40 например)', backToMenu);
  } else {
    await ctx.reply('🎫 Введите промокод:', backToMenu);
  }
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
    const mode = await getChatMode(userId);
    
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
        text === '😈 Режим общения' ||
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
        
        if (mode === 'rude') {
          await ctx.reply(`✅ Цель "${name}" создана! Не проеби бабки, пидор! 🎯`);
        } else {
          await ctx.reply(`✅ Цель "${name}" создана! Удачи! 🎯`);
        }
      } catch (err) {
        if (mode === 'rude') {
          await ctx.reply('❌ Неправильно написал, лох! Используй: цель:Название,сумма,дата');
        } else {
          await ctx.reply('❌ Неправильный формат. Используй: цель:Название,сумма,дата');
        }
      }
      
      userStates.delete(userId);
      await ctx.reply('Главное меню:', mainMenu);
      return;
    }
    
    // Обычная запись дохода/расхода
    console.log(`📨 Сообщение от ${userId}: "${text}"`);
    
    const match = text.match(/(-?\d+[\d\s]*[\d,.]*|\d+[\d\s]*[\d,.]*)/);
    if (!match) {
      if (mode === 'rude') {
        await ctx.reply('❌ Где сумма, лох? Пример: "500 зарплата" или "кофе 300"', backToMenu);
      } else {
        await ctx.reply('❌ Не могу найти сумму. Пример: "500 зарплата" или "кофе 300"', backToMenu);
      }
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
    
    if (mode === 'rude') {
      if (type === 'income') {
        await ctx.reply(
          `${emoji} **Записал бабки:** ${amount}₽\n` +
          `📌 Категория: ${category}\n\n` +
          `Не проеби всё в первый же день, пидор!`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(
          `${emoji} **Записал твой проёб:** ${amount}₽\n` +
          `📌 Категория: ${category}\n\n` +
          `Скоро без штанов останешься, бля!`,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      await ctx.reply(
        `${emoji} **Записано:** ${type === 'income' ? 'доход' : 'расход'} ${amount}₽\n` +
        `📌 **Категория:** ${category}`,
        { parse_mode: 'Markdown' }
      );
    }
    
    userStates.delete(userId);
    await ctx.reply('Что делаем дальше?', mainMenu);
    
  } catch (err) {
    console.error('❌ Ошибка обработки сообщения:', err);
    ctx.reply('❌ Произошла ошибка. Попробуй еще раз.', mainMenu);
  }
});

// ==================== ОБРАБОТКА ПЛАТЕЖЕЙ ====================
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
    'INSERT INTO premium_users (user_id, valid_until, chat_mode) VALUES ($1, NOW() + INTERVAL \'30 days\', $2) ON CONFLICT (user_id) DO UPDATE SET valid_until = NOW() + INTERVAL \'30 days\'',
    [userId, 'normal']
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
  console.log('😈 Premium用户可以 переключать режим общения!');
}

startBot().catch(err => {
  console.error('❌ Ошибка запуска бота:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));