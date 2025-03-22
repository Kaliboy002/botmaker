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
  adminState: { type: String, default: 'none' },
  adminMessageId: { type: Number, default: null },
});

const ChannelUrlSchema = new mongoose.Schema({
  botToken: { type: String, required: true, unique: true },
  url: { type: String, default: 'https://t.me/Kali_Linux_BOTS' },
});

const Bot = mongoose.model('Bot', BotSchema);
const BotUser = mongoose.model('BotUser', BotUserSchema);
const ChannelUrl = mongoose.model('ChannelUrl', ChannelUrlSchema);

// Admin Panel Keyboard
const adminPanelKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 Statistics', callback_data: 'stats' }],
      [{ text: '📢 Broadcast', callback_data: 'broadcast' }],
      [{ text: '🔗 Set Channel URL', callback_data: 'set_channel' }],
      [{ text: '❌ Close Panel', callback_data: 'close' }],
    ],
  },
};

// Cancel Keyboard
const cancelKeyboard = {
  reply_markup: {
    inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel_action' }]],
  },
};

// Vercel Handler
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(200).send('Created Bot is running.');
    }

    const botToken = req.query.token;
    if (!botToken) {
      return res.status(400).json({ error: 'No token provided' });
    }

    const botInfo = await Bot.findOne({ token: botToken });
    if (!botInfo) {
      return res.status(404).json({ error: 'Bot not found' });
    }

    const bot = new Telegraf(botToken);
    const update = req.body;
    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
    const fromId = (update.message?.from?.id || update.callback_query?.from?.id)?.toString();
    const text = update.message?.text;
    const message = update.message;

    if (!chatId || !fromId) {
      return res.status(400).json({ error: 'Invalid update' });
    }

    // Initialize/Update Bot User
    let botUser = await BotUser.findOne({ botToken, userId: fromId });
    if (!botUser) {
      botUser = await BotUser.create({ botToken, userId: fromId });
    }

    const channelUrlDoc = await ChannelUrl.findOne({ botToken });
    const channelUrl = channelUrlDoc?.url || 'https://t.me/Kali_Linux_BOTS';

    // /start Command
    if (text === '/start') {
      if (botUser.hasJoined) {
        await bot.telegram.sendMessage(chatId, 'Welcome back! How can I assist you?');
      } else {
        await bot.telegram.sendMessage(chatId, 'Please join our channel to proceed:', {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Join Channel', url: channelUrl },
                { text: '✅ Joined', callback_data: 'joined' },
              ],
            ],
          },
        });
      }
      botUser.step = 'none';
      botUser.adminState = 'none';
      await botUser.save();
    }

    // /panel Command (Admin Only)
    if (text === '/panel' && fromId === botInfo.creatorId) {
      const panelMessage = await bot.telegram.sendMessage(chatId, '🔧 Admin Panel', adminPanelKeyboard);
      botUser.adminState = 'panel_open';
      botUser.adminMessageId = panelMessage.message_id;
      await botUser.save();
    }

    // Handle Callback Queries
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const callbackData = callbackQuery.data;

      // Verify admin rights and panel state
      if (fromId !== botInfo.creatorId) {
        await bot.telegram.answerCallbackQuery(callbackQuery.id, { text: 'Unauthorized access' });
        return res.status(200).json({ ok: true });
      }

      // Handle "Joined" callback
      if (callbackData === 'joined') {
        botUser.hasJoined = true;
        await botUser.save();
        await bot.telegram.answerCallbackQuery(callbackQuery.id, { text: 'Verified!' });
        await bot.telegram.sendMessage(chatId, 'Welcome! How can I assist you?');
        return res.status(200).json({ ok: true });
      }

      // Handle Admin Panel Actions
      if (botUser.adminState !== 'none') {
        switch (callbackData) {
          case 'stats':
            const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
            const createdAt = new Date(botInfo.createdAt * 1000).toLocaleString();
            const statsMessage = `📊 Bot Statistics - @${botInfo.username}\n\n` +
                               `👥 Total Users: ${userCount}\n` +
                               `📅 Created: ${createdAt}\n` +
                               `🔗 Channel: ${channelUrl}`;
            await bot.telegram.sendMessage(chatId, statsMessage);
            await bot.telegram.answerCallbackQuery(callbackQuery.id);
            break;

          case 'broadcast':
            const totalUsers = await BotUser.countDocuments({ botToken, hasJoined: true });
            if (totalUsers === 0) {
              await bot.telegram.sendMessage(chatId, '❌ No users to broadcast to yet.');
            } else {
              await bot.telegram.sendMessage(chatId,
                `📢 Enter your broadcast message (supports text, photo, video, etc.) for ${totalUsers} users:`,
                cancelKeyboard
              );
              botUser.adminState = 'awaiting_broadcast';
              await botUser.save();
            }
            await bot.telegram.answerCallbackQuery(callbackQuery.id);
            break;

          case 'set_channel':
            await bot.telegram.sendMessage(chatId,
              `🔗 Current Channel: ${channelUrl}\n\n` +
              `Enter new channel URL (e.g., https://t.me/your_channel):`,
              cancelKeyboard
            );
            botUser.adminState = 'awaiting_channel';
            await botUser.save();
            await bot.telegram.answerCallbackQuery(callbackQuery.id);
            break;

          case 'close':
            await bot.telegram.deleteMessage(chatId, botUser.adminMessageId);
            botUser.adminState = 'none';
            botUser.adminMessageId = null;
            await botUser.save();
            await bot.telegram.answerCallbackQuery(callbackQuery.id);
            break;

          case 'cancel_action':
            if (botUser.adminState === 'awaiting_broadcast' || botUser.adminState === 'awaiting_channel') {
              await bot.telegram.sendMessage(chatId, 'Action cancelled.', adminPanelKeyboard);
              botUser.adminState = 'panel_open';
              await botUser.save();
            }
            await bot.telegram.answerCallbackQuery(callbackQuery.id);
            break;
        }
      }
    }

    // Handle Admin Input
    if (text && fromId === botInfo.creatorId && botUser.adminState !== 'none' && text !== '/panel' && text !== '/start') {
      if (botUser.adminState === 'awaiting_broadcast') {
        const targetUsers = await BotUser.find({ botToken, hasJoined: true });
        let successCount = 0;
        let failCount = 0;

        for (const user of targetUsers) {
          if (user.userId === fromId) continue; // Skip admin
          try {
            if (message.text) {
              await bot.telegram.sendMessage(user.userId, message.text);
            } else if (message.photo) {
              await bot.telegram.sendPhoto(user.userId, message.photo[message.photo.length - 1].file_id, {
                caption: message.caption || '',
              });
            } else if (message.video) {
              await bot.telegram.sendVideo(user.userId, message.video.file_id, {
                caption: message.caption || '',
              });
            } else if (message.document) {
              await bot.telegram.sendDocument(user.userId, message.document.file_id, {
                caption: message.caption || '',
              });
            } else if (message.audio) {
              await bot.telegram.sendAudio(user.userId, message.audio.file_id, {
                caption: message.caption || '',
              });
            } else if (message.voice) {
              await bot.telegram.sendVoice(user.userId, message.voice.file_id);
            } else if (message.sticker) {
              await bot.telegram.sendSticker(user.userId, message.sticker.file_id);
            }
            successCount++;
            await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
          } catch (error) {
            console.error(`Broadcast failed for ${user.userId}:`, error.message);
            failCount++;
          }
        }

        await bot.telegram.sendMessage(chatId,
          `📢 Broadcast Results:\n✅ Success: ${successCount}\n❌ Failed: ${failCount}`,
          adminPanelKeyboard
        );
        botUser.adminState = 'panel_open';
        await botUser.save();
      } else if (botUser.adminState === 'awaiting_channel') {
        let newUrl = text.trim();
        if (!/^https:\/\/t\.me\//i.test(newUrl)) {
          newUrl = 'https://t.me/' + newUrl.replace(/^@|https?:\/\//gi, '');
        }

        const urlRegex = /^https:\/\/t\.me\/.+$/;
        if (!urlRegex.test(newUrl)) {
          await bot.telegram.sendMessage(chatId,
            '❌ Invalid URL. Please use format: https://t.me/channel_name',
            cancelKeyboard
          );
          return;
        }

        await ChannelUrl.findOneAndUpdate(
          { botToken },
          { url: newUrl },
          { upsert: true }
        );
        await bot.telegram.sendMessage(chatId, `✅ Channel URL updated to: ${newUrl}`, adminPanelKeyboard);
        botUser.adminState = 'panel_open';
        await botUser.save();
      }
    }

    // Regular User Messages
    if (botUser.hasJoined && botUser.step === 'none' && botUser.adminState === 'none' && text !== '/start' && text !== '/panel') {
      if (message.text) {
        await bot.telegram.sendMessage(chatId, `Echo: ${message.text}`);
      } else if (message.photo) {
        await bot.telegram.sendPhoto(chatId, message.photo[message.photo.length - 1].file_id, {
          caption: message.caption || 'Photo received',
        });
      } // Add other media types as needed
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error in created.js:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};
