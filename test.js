const { Telegraf } = require('telegraf');
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(token);

bot.on('text', (ctx) => {
  console.log('Получено сообщение от:', ctx.from.id);
  console.log('Текст:', ctx.message.text);
  ctx.reply('Привет! Тест работает! Твой ID: ' + ctx.from.id);
});

bot.launch();
console.log('Тестовый бот запущен. Жду сообщения...');