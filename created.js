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

// Admin Panel Inline Buttons
const adminPanel = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📊 Statistics', callback_data: 'statistics' }],
      [{ text: '📍 Broadcast', callback_data: 'broadcast' }],
      [{ text: '🔗 Set Channel URL', callback_data: 'set_channel_url' }],
      [{ text: '↩️ Back', callback_data: 'back' }],
    ],
  },
};

// Cancel Button for Broadcast and Set Channel URL
const cancelButton = {
  reply_markup: {
    inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel' }]],
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

    // Handle Admin Panel Callbacks
    if (update.callback_query) {
      const callbackData = update.callback_query.data;
      const callbackQuery = update.callback_query;

      try {
        // Acknowledge the callback immediately to avoid delays
        await bot.telegram.answerCallbackQuery(callbackQuery.id);

        if (botUser.step !== 'admin_panel' && callbackData !== 'cancel') {
          return; // Ignore callbacks if not in admin panel mode
        }

        if (callbackData === 'statistics') {
          const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
          const createdAt = new Date(botInfo.createdAt * 1000).toISOString();
          const message = `📊 Statistics for @${botInfo.username}\n\n` +
                         `👥 Total Users: ${userCount}\n` +
                         `📅 Bot Created: ${createdAt}\n` +
                         `🔗 Channel URL: ${channelUrl}`;
          await bot.telegram.sendMessage(chatId, message);
        } else if (callbackData === 'broadcast') {
          const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
          if (userCount === 0) {
            await bot.telegram.sendMessage(chatId, '❌ No users have joined this bot yet.');
          } else {
            await bot.telegram.sendMessage(chatId, `📢 Send your message or content to broadcast to ${userCount} users:`, cancelButton);
            botUser.step = 'broadcast';
            await botUser.save();
          }
        } else if (callbackData === 'set_channel_url') {
          await bot.telegram.sendMessage(chatId,
            `🔗 Current Channel URL:\n${channelUrl}\n\n` +
            `Enter the new channel URL (e.g., https://t.me/your_channel):`,
            cancelButton
          );
          botUser.step = 'set_channel_url';
          await botUser.save();
        } else if (callbackData === 'back') {
          await bot.telegram.sendMessage(chatId, '↩️ Returned to normal mode.');
          botUser.step = 'none';
          await botUser.save();
        } else if (callbackData === 'cancel') {
          if (botUser.step === 'broadcast' || botUser.step === 'set_channel_url') {
            await bot.telegram.sendMessage(chatId, '↩️ Action cancelled.');
            botUser.step = 'admin_panel';
            await botUser.save();
          }
        }
      } catch (error) {
        console.error('Error in callback handler:', error);
        await bot.telegram.sendMessage(chatId, '❌ An error occurred while processing your request.');
      }
    }

    // Handle Broadcast and Set Channel URL Input
    if (text && (botUser.step === 'broadcast' || botUser.step === 'set_channel_url')) {
      try {
        if (botUser.step === 'broadcast') {
          const targetUsers = await BotUser.find({ botToken, hasJoined: true });
          let successCount = 0;
          let failCount = 0;

          for (const targetUser of targetUsers) {
            if (targetUser.userId === fromId) continue; // Skip admin
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

          await bot.telegram.sendMessage(chatId,
            `📢 Broadcast completed!\n` +
            `✅ Sent to ${successCount} users\n` +
            `❌ Failed for ${failCount} users`
          );
          botUser.step = 'admin_panel';
          await botUser.save();
        } else if (botUser.step === 'set_channel_url') {
          let inputUrl = text.trim();
          inputUrl = inputUrl.replace(/^(https?:\/\/)?/i, '');
          inputUrl = inputUrl.replace(/\/+$/, '');
          if (!/^t\.me\//i.test(inputUrl)) {
            inputUrl = 't.me/' + inputUrl;
          }
          const correctedUrl = 'https://' + inputUrl;

          const urlRegex = /^https:\/\/t\.me\/.+$/;
          if (!urlRegex.test(correctedUrl)) {
            await bot.telegram.sendMessage(chatId, '❌ Invalid URL. Please provide a valid Telegram channel URL (e.g., https://t.me/your_channel).', cancelButton);
            return;
          }

          await ChannelUrl.findOneAndUpdate(
            { botToken },
            { botToken, url: correctedUrl },
            { upsert: true }
          );

          await bot.telegram.sendMessage(chatId, `✅ Channel URL has been set to:\n${correctedUrl}`);
          botUser.step = 'admin_panel';
          await botUser.save();
        }
      } catch (error) {
        console.error('Error in broadcast/set_channel_url handler:', error);
        await bot.telegram.sendMessage(chatId, '❌ An error occurred while processing your request.');
        botUser.step = 'admin_panel';
        await botUser.save();
      }
    }

    // Handle Regular Messages (Only if in 'none' step and user has joined)
    if (botUser.hasJoined && botUser.step === 'none' && text !== '/start' && text !== '/panel') {
      try {
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
      } catch (error) {
        console.error('Error handling regular message:', error);
        await bot.telegram.sendMessage(chatId, '❌ An error occurred while processing your message.');
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error in created.js:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};
