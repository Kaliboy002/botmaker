const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('Missing MONGO_URI environment variable');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// MongoDB Models
const BotSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  creatorId: { type: String, required: true },
  createdAt: { type: Number, default: () => Math.floor(Date.now() / 1000) },
});

const BotUserSchema = new mongoose.Schema({
  botToken: { type: String, required: true },
  userId: { type: String, required: true },
  hasJoined: { type: Boolean, default: false },
  step: { type: String, default: 'none' },
});

const ChannelUrlSchema = new mongoose.Schema({
  botToken: { type: String, required: true, unique: true },
  url: { type: String, default: 'https://t.me/Kali_Linux_BOTS' },
});

const Bot = mongoose.model('Bot', BotSchema);
const BotUser = mongoose.model('BotUser', BotUserSchema);
const ChannelUrl = mongoose.model('ChannelUrl', ChannelUrlSchema);

// Admin Panel Keyboard
const adminPanel = {
  reply_markup: {
    keyboard: [
      [{ text: '📊 Statistics' }],
      [{ text: '📍 Broadcast' }],
      [{ text: '🔗 Set Channel URL' }],
      [{ text: '↩️ Back' }],
    ],
    resize_keyboard: true,
  },
};

// Cancel Keyboard
const cancelKeyboard = {
  reply_markup: {
    keyboard: [[{ text: 'Cancel' }]],
    resize_keyboard: true,
  },
};

// Vercel Handler for Created Bots
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

    const botInfo = await Bot.findOne({ token: botToken });
    if (!botInfo) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }

    const bot = new Telegraf(botToken);
    const update = req.body;
    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
    const fromId = (update.message?.from?.id || update.callback_query?.from?.id)?.toString();
    const text = update.message?.text;
    const message = update.message;

    if (!chatId || !fromId) {
      res.status(400).json({ error: 'Invalid update' });
      return;
    }

    // Initialize Bot User
    let botUser = await BotUser.findOne({ botToken, userId: fromId });
    if (!botUser) {
      botUser = await BotUser.create({ botToken, userId: fromId, hasJoined: false, step: 'none' });
    }

    const channelUrlDoc = await ChannelUrl.findOne({ botToken });
    const channelUrl = channelUrlDoc ? channelUrlDoc.url : 'https://t.me/Kali_Linux_BOTS';

    // /start Command
    if (text === '/start') {
      try {
        if (botUser.hasJoined) {
          await bot.telegram.sendMessage(chatId, 'Hi, how are you?');
        } else {
          await bot.telegram.sendMessage(chatId, 'Please join our channel and click on Joined button to proceed.', {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Join Channel', url: channelUrl },
                  { text: 'Joined', callback_data: 'joined' },
                ],
              ],
            },
          });
        }
        botUser.step = 'none';
        await botUser.save();
      } catch (error) {
        console.error('Error in /start:', error);
        await bot.telegram.sendMessage(chatId, '❌ An error occurred. Please try again.');
      }
    }

    // Handle "Joined" Callback
    if (update.callback_query?.data === 'joined') {
      try {
        const callbackQuery = update.callback_query;
        botUser.hasJoined = true;
        await botUser.save();

        await bot.telegram.answerCallbackQuery(callbackQuery.id, { text: 'Thank you for joining!' });
        await bot.telegram.sendMessage(chatId, 'Hi, how are you?');
      } catch (error) {
        console.error('Error in joined callback:', error);
        await bot.telegram.answerCallbackQuery(update.callback_query.id, { text: '❌ An error occurred.' });
      }
    }

    // /panel Command (Admin Only)
    if (text === '/panel' && fromId === botInfo.creatorId) {
      try {
        await bot.telegram.sendMessage(chatId, '🔧 Admin Panel', adminPanel);
        botUser.step = 'admin_panel';
        await botUser.save();
      } catch (error) {
        console.error('Error in /panel:', error);
        await bot.telegram.sendMessage(chatId, '❌ An error occurred while opening the admin panel.');
      }
    }

    // Admin Panel Commands (Use hears for keyboard buttons)
    if (botUser.step === 'admin_panel') {
      if (text === '📊 Statistics') {
        try {
          const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
          const createdAt = new Date(botInfo.createdAt * 1000).toISOString();
          const message = `📊 Statistics for @${botInfo.username}\n\n` +
                         `👥 Total Users: ${userCount}\n` +
                         `📅 Bot Created: ${createdAt}\n` +
                         `🔗 Channel URL: ${channelUrl}`;
          await bot.telegram.sendMessage(chatId, message);
        } catch (error) {
          console.error('Error in Statistics:', error);
          await bot.telegram.sendMessage(chatId, '❌ Failed to load statistics. Please try again.');
        }
      } else if (text === '📍 Broadcast') {
        try {
          const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
          if (userCount === 0) {
            await bot.telegram.sendMessage(chatId, '❌ No users have joined this bot yet.');
          } else {
            await bot.telegram.sendMessage(chatId, `📢 Send your message or content to broadcast to ${userCount} users:`, cancelKeyboard);
            botUser.step = 'broadcast';
            await botUser.save();
          }
        } catch (error) {
          console.error('Error in Broadcast:', error);
          await bot.telegram.sendMessage(chatId, '❌ Failed to initiate broadcast. Please try again.');
        }
      } else if (text === '🔗 Set Channel URL') {
        try {
          await bot.telegram.sendMessage(chatId,
            `🔗 Current Channel URL:\n${channelUrl}\n\n` +
            `Enter the new channel URL (e.g., https://t.me/your_channel):`,
            cancelKeyboard
          );
          botUser.step = 'set_channel_url';
          await botUser.save();
        } catch (error) {
          console.error('Error in Set Channel URL:', error);
          await bot.telegram.sendMessage(chatId, '❌ Failed to set channel URL. Please try again.');
        }
      } else if (text === '↩️ Back') {
        try {
          await bot.telegram.sendMessage(chatId, '↩️ Returned to normal mode.', {
            reply_markup: { remove_keyboard: true },
          });
          botUser.step = 'none';
          await botUser.save();
        } catch (error) {
          console.error('Error in Back:', error);
          await bot.telegram.sendMessage(chatId, '❌ Failed to return to normal mode. Please try again.');
        }
      }
    }

    // Handle Broadcast and Set Channel URL Input
    if (botUser.step === 'broadcast' && text === 'Cancel') {
      try {
        await bot.telegram.sendMessage(chatId, '↩️ Broadcast cancelled.', adminPanel);
        botUser.step = 'admin_panel';
        await botUser.save();
      } catch (error) {
        console.error('Error in Cancel Broadcast:', error);
        await bot.telegram.sendMessage(chatId, '❌ Failed to cancel broadcast. Please try again.');
      }
    } else if (botUser.step === 'set_channel_url' && text === 'Cancel') {
      try {
        await bot.telegram.sendMessage(chatId, '↩️ Channel URL setting cancelled.', adminPanel);
        botUser.step = 'admin_panel';
        await botUser.save();
      } catch (error) {
        console.error('Error in Cancel Set Channel URL:', error);
        await bot.telegram.sendMessage(chatId, '❌ Failed to cancel channel URL setting. Please try again.');
      }
    } else if (botUser.step === 'broadcast' && text !== 'Cancel') {
      try {
        const targetUsers = await BotUser.find({ botToken, hasJoined: true });
        let successCount = 0;
        let failCount = 0;

        for (const targetUser of targetUsers) {
          if (targetUser.userId === fromId) continue;
          try {
            if (message.text) {
              await bot.telegram.sendMessage(targetUser.userId, message.text);
            } else if (message.photo) {
              const photo = message.photo[message.photo.length - 1].file_id;
              await bot.telegram.sendPhoto(targetUser.userId, photo, { caption: message.caption || '' });
            } else if (message.document) {
              await bot.telegram.sendDocument(targetUser.userId, message.document.file_id, { caption: message.caption || '' });
           }
