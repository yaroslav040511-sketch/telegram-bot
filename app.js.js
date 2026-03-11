const { Telegraf } = require('telegraf');
const express = require('express');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(token);

// Настройка Express сервера (нужен для Render)
const app = express();
const PORT = process.env.PORT || 3000;

// Эндпоинт для проверки здоровья
app.get('/', (req, res) => {
  res.send('Бот работает!');
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Запускаем Express сервер
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// Команды бота
bot.start((ctx) => {
  ctx.reply('Привет! Я финансовый бот. Работаю 24/7 на Render!');
});

bot.on('text', (ctx) => {
  const text = ctx.message.text;
  console.log('Получено:', text);
  
  // Простой парсер для демо
  if (text.startsWith('-') || text.includes('трата') || text.includes('кофе') || text.includes('обед')) {
    ctx.reply('✅ Расход записан: ' + text);
  } else if (text.match(/^\d/)) {
    ctx.reply('✅ Доход записан: ' + text);
  } else {
    ctx.reply('Команда не распознана. Попробуй: "5000 зарплата" или "-300 кофе"');
  }
});

// Запускаем бота
bot.launch()
  .then(() => console.log('Бот запущен и готов к работе!'))
  .catch(err => console.error('Ошибка запуска бота:', err));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));