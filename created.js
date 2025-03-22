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
  userStep: { type: String, default: 'none' },
  adminState: { type: String, default: 'none' }, // Added for admin panel state
  lastInteraction: { type: Number, default: () => Math.floor(Date.now() / 1000) },
});

BotUserSchema.index({ botToken: 1, userId: 1 }, { unique: true });
BotUserSchema.index({ botToken: 1, hasJoined: 1 });

const ChannelUrlSchema = new mongoose.Schema({
  botToken: { type: String, required: true, unique: true },
  url: { type: String, default: 'https://t.me/Kali_Linux_BOTS' },
});

const Bot = mongoose.model('Bot', BotSchema);
const BotUser = mongoose.model('BotUser', BotUserSchema);
const ChannelUrl = mongoose.model('ChannelUrl', ChannelUrlSchema);

// Admin Panel Keyboard (same as original)
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

// Helper Functions
const getChannelUrl = async (botToken) => {
  const channelUrlDoc = await ChannelUrl.findOne({ botToken }).lean();
  return channelUrlDoc?.url || 'https://t.me/Kali_Linux_BOTS';
};

const broadcastMessage = async (bot, message, targetUsers, adminId) => {
  let successCount = 0;
  let failCount = 0;

  for (const targetUser of targetUsers) {
    if (targetUser.userId === adminId) continue; // Skip admin
    try {
      if (message.text) {
        await bot.telegram.sendMessage(targetUser.userId, message.text);
      } else if (message.photo) {
        const photo = message.photo[message.photo.length - 1].file_id;
        await bot.telegram.sendPhoto(targetUser.userId, photo, { caption: message.caption || '' });
      } else if (message.document) {
        await bot.telegram.sendDocument(targetUser.userId, message.document.file_id, { caption: message.caption || '' });
      } else if (message.video) {
        await bot.telegram.sendVideo(targetUser.userId, message.video.file_id, { caption: message.caption || '' });
      } else if (message.audio) {
        await bot.telegram.sendAudio(targetUser.userId, message.audio.file_id, { caption: message.caption || '' });
      } else if (message.voice) {
        await bot.telegram.sendVoice(targetUser.userId, message.voice.file_id);
      } else if (message.sticker) {
        await bot.telegram.sendSticker(targetUser.userId, message.sticker.file_id);
      } else {
        await bot.telegram.sendMessage(targetUser.userId, 'Unsupported message type');
      }
      successCount++;
      await new Promise(resolve => setTimeout(resolve, 34)); // Rate limiting
    } catch (error) {
      console.error(`Broadcast failed for user ${targetUser.userId}:`, error.message);
      failCount++;
    }
  }

  return { successCount, failCount };
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

    if (!chatId || !fromId) {
      res.status(400).json({ error: 'Invalid update' });
      return;
    }

    // Initialize Bot User
    let botUser = await BotUser.findOne({ botToken, userId: fromId });
    if (!botUser) {
      botUser = await BotUser.create({ botToken, userId: fromId, hasJoined: false, userStep: 'none', adminState: 'none' });
    }

    botUser.lastInteraction = Math.floor(Date.now() / 1000);
    await botUser.save();

    const channelUrl = await getChannelUrl(botToken);

    // Handle Messages
    if (update.message) {
      const message = update.message;
      const text = message.text;

      // /start Command
      if (text === '/start') {
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
        botUser.userStep = 'none';
        botUser.adminState = 'none';
        await botUser.save();
      }

      // /panel Command (Admin Only)
      else if (text === '/panel' && fromId === botInfo.creatorId) {
        await bot.telegram.sendMessage(chatId, '🔧 Admin Panel', adminPanel);
        botUser.adminState = 'admin_panel';
        await botUser.save();
      }

      // Handle Admin Panel Actions
      else if (fromId === botInfo.creatorId && botUser.adminState === 'admin_panel') {
        if (text === '📊 Statistics') {
          const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
          const createdAt = new Date(botInfo.createdAt * 1000).toISOString();
          const message = `📊 Statistics for @${botInfo.username}\n\n` +
                         `👥 Total Users: ${userCount}\n` +
                         `📅 Bot Created: ${createdAt}\n` +
                         `🔗 Channel URL: ${channelUrl}`;
          await bot.telegram.sendMessage(chatId, message, adminPanel);
        } else if (text === '📍 Broadcast') {
          const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
          if (userCount === 0) {
            await bot.telegram.sendMessage(chatId, '❌ No users have joined this bot yet.', adminPanel);
          } else {
            await bot.telegram.sendMessage(chatId, `📢 Send your message or content to broadcast to ${userCount} users:`, cancelKeyboard);
            botUser.adminState = 'awaiting_broadcast';
            await botUser.save();
          }
        } else if (text === '🔗 Set Channel URL') {
          await bot.telegram.sendMessage(chatId,
            `🔗 Current Channel URL:\n${channelUrl}\n\n` +
            `Enter the new channel URL (e.g., https://t.me/your_channel):`,
            cancelKeyboard
          );
          botUser.adminState = 'awaiting_channel';
          await botUser.save();
        } else if (text === '↩️ Back') {
          await bot.telegram.sendMessage(chatId, '↩️ Returned to normal mode.', {
            reply_markup: { remove_keyboard: true },
          });
          botUser.adminState = 'none';
          await botUser.save();
        }
      }

      // Handle Broadcast Input
      else if (fromId === botInfo.creatorId && botUser.adminState === 'awaiting_broadcast') {
        if (text === 'Cancel') {
          await bot.telegram.sendMessage(chatId, '↩️ Broadcast cancelled.', adminPanel);
          botUser.adminState = 'admin_panel';
          await botUser.save();
          return;
        }

        const targetUsers = await BotUser.find({ botToken, hasJoined: true });
        const { successCount, failCount } = await broadcastMessage(bot, message, targetUsers, fromId);

        await bot.telegram.sendMessage(chatId,
          `📢 Broadcast completed!\n` +
          `✅ Sent to ${successCount} users\n` +
          `❌ Failed for ${failCount} users`,
          adminPanel
        );
        botUser.adminState = 'admin_panel';
        await botUser.save();
      }

      // Handle Set Channel URL Input
      else if (fromId === botInfo.creatorId && botUser.adminState === 'awaiting_channel') {
        if (text === 'Cancel') {
          await bot.telegram.sendMessage(chatId, '↩️ Channel URL setting cancelled.', adminPanel);
          botUser.adminState = 'admin_panel';
          await botUser.save();
          return;
        }

        let inputUrl = text.trim();
        inputUrl = inputUrl.replace(/^(https?:\/\/)?/i, '');
        inputUrl = inputUrl.replace(/\/+$/, '');
        if (!/^t\.me\//i.test(inputUrl)) {
          inputUrl = 't.me/' + inputUrl;
        }
        const correctedUrl = 'https://' + inputUrl;

        const urlRegex = /^https:\/\/t\.me\/.+$/;
        if (!urlRegex.test(correctedUrl)) {
          await bot.telegram.sendMessage(chatId, '❌ Invalid URL. Please provide a valid Telegram channel URL (e.g., https://t.me/your_channel).', cancelKeyboard);
          return;
        }

        await ChannelUrl.findOneAndUpdate(
          { botToken },
          { botToken, url: correctedUrl },
          { upsert: true }
        );

        await bot.telegram.sendMessage(chatId, `✅ Channel URL has been set to:\n${correctedUrl}`, adminPanel);
        botUser.adminState = 'admin_panel';
        await botUser.save();
      }

      // Handle Regular Messages (Only if in 'none' state and user has joined)
      else if (botUser.hasJoined && botUser.adminState === 'none' && text !== '/start' && text !== '/panel') {
        if (message.text) {
          await bot.telegram.sendMessage(chatId, message.text);
        } else if (message.photo) {
          const photo = message.photo[message.photo.length - 1].file_id;
          await bot.telegram.sendPhoto(chatId, photo, { caption: message.caption || '' });
        } else if (message.document) {
          await bot.telegram.sendDocument(chatId, message.document.file_id, { caption: message.caption || '' });
        } else if (message.video) {
          await bot.telegram.sendVideo(chatId, message.video.file_id, { caption: message.caption || '' });
        } else if (message.audio) {
          await bot.telegram.sendAudio(chatId, message.audio.file_id, { caption: message.caption || '' });
        } else if (message.voice) {
          await bot.telegram.sendVoice(chatId, message.voice.file_id);
        } else if (message.sticker) {
          await bot.telegram.sendSticker(chatId, message.sticker.file_id);
        } else {
          await bot.telegram.sendMessage(chatId, 'Unsupported message type');
        }
      }
    }

    // Handle "Joined" Callback
    if (update.callback_query?.data === 'joined') {
      const callbackQuery = update.callback_query;
      botUser.hasJoined = true;
      await botUser.save();

      await bot.telegram.answerCallbackQuery(callbackQuery.id, { text: 'Thank you for joining!' });
      await bot.telegram.sendMessage(chatId, 'Hi, how are you?');
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error in created.js:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};
