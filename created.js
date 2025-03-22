const { Telegraf } = require('telegraf');
const setupCreatedBotHandlers = require('./createdBotHandlers');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(200).send('Created Bot is running.');
      return;
    }

    const botToken = req.query.token;
    if (!botToken) {
      res.status(400).json({ error: 'No token provided' });
      return;
    }

    const bot = new Telegraf(botToken);
    bot.botToken = botToken;

    setupCreatedBotHandlers(bot);

    await bot.handleUpdate(req.body);

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error in created.js:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};
