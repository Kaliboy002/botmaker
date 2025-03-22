const { Bot, BotUser, ChannelUrl } = require('./models'); // Assume models are exported

const setupCreatedBotHandlers = (bot) => {
  bot.use(async (ctx, next) => {
    const botToken = bot.botToken;
    ctx.state.botToken = botToken;
    await next();
  });

  bot.start(async (ctx) => {
    const { botToken } = ctx.state;
    const fromId = ctx.from.id.toString();
    let botUser = await BotUser.findOne({ botToken, userId: fromId });
    if (!botUser) {
      botUser = await BotUser.create({ botToken, userId: fromId, hasJoined: false, step: 'none' });
    }
    const channelUrlDoc = await ChannelUrl.findOne({ botToken });
    const channelUrl = channelUrlDoc ? channelUrlDoc.url : 'https://t.me/Kali_Linux_BOTS';
    if (botUser.hasJoined) {
      await ctx.reply('Hi, how are you?');
    } else {
      await ctx.reply('Please join our channel and click on Joined button to proceed.', {
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
  });

  bot.on('callback_query', async (ctx) => {
    const { botToken } = ctx.state;
    const fromId = ctx.from.id.toString();
    const callbackData = ctx.callbackQuery.data;
    const chatId = ctx.callbackQuery.message.chat.id;

    try {
      await ctx.answerCbQuery();

      let botUser = await BotUser.findOne({ botToken, userId: fromId });
      if (!botUser) {
        botUser = await BotUser.create({ botToken, userId: fromId, hasJoined: false, step: 'none' });
      }

      if (callbackData === 'joined') {
        botUser.hasJoined = true;
        await botUser.save();
        await ctx.reply('Hi, how are you?');
      } else if (botUser.step === 'admin_panel') {
        if (callbackData === 'statistics') {
          const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
          const botInfo = await Bot.findOne({ token: botToken });
          const createdAt = new Date(botInfo.createdAt * 1000).toISOString();
          const channelUrlDoc = await ChannelUrl.findOne({ botToken });
          const channelUrl = channelUrlDoc ? channelUrlDoc.url : 'https://t.me/Kali_Linux_BOTS';
          const message = `📊 Statistics for @${botInfo.username}\n\n` +
                         `👥 Total Users: ${userCount}\n` +
                         `📅 Bot Created: ${createdAt}\n` +
                         `🔗 Channel URL: ${channelUrl}`;
          await ctx.reply(message);
        } else if (callbackData === 'broadcast') {
          const userCount = await BotUser.countDocuments({ botToken, hasJoined: true });
          if (userCount === 0) {
            await ctx.reply('❌ No users have joined this bot yet.');
          } else {
            await ctx.reply(`📢 Send your message or content to broadcast to ${userCount} users:`, {
              reply_markup: {
                inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel' }]],
              },
            });
            await BotUser.updateOne({ botToken, userId: fromId }, { step: 'broadcast' });
          }
        } else if (callbackData === 'set_channel_url') {
          const channelUrlDoc = await ChannelUrl.findOne({ botToken });
          const channelUrl = channelUrlDoc ? channelUrlDoc.url : 'https://t.me/Kali_Linux_BOTS';
          await ctx.reply(
            `🔗 Current Channel URL:\n${channelUrl}\n\n` +
            `Enter the new channel URL (e.g., https://t.me/your_channel):`,
            {
              reply_markup: {
                inline_keyboard: [[{ text: 'Cancel', callback_data: 'cancel' }]],
              },
            }
          );
          await BotUser.updateOne({ botToken, userId: fromId }, { step: 'set_channel_url' });
        } else if (callbackData === 'back') {
          await ctx.reply('↩️ Returned to normal mode.');
          await BotUser.updateOne({ botToken, userId: fromId }, { step: 'none' });
        } else if (callbackData === 'cancel') {
          if (botUser.step === 'broadcast' || botUser.step === 'set_channel_url') {
            await ctx.reply('↩️ Action cancelled.');
            await BotUser.updateOne({ botToken, userId: fromId }, { step: 'admin_panel' });
          }
        }
      }
    } catch (error) {
      console.error('Error in callback_query handler:', error);
      await ctx.reply('❌ An error occurred while processing your request.');
    }
  });

  bot.on('message', async (ctx) => {
    const { botToken } = ctx.state;
    const fromId = ctx.from.id.toString();
    const text = ctx.message.text;
    const message = ctx.message;

    let botUser = await BotUser.findOne({ botToken, userId: fromId });
    if (!botUser) {
      return; // Ignore if not registered
    }

    if (botUser.step === 'broadcast') {
      const targetUsers = await BotUser.find({ botToken, hasJoined: true });
      let successCount = 0;
      let failCount = 0;

      for (const targetUser of targetUsers) {
        if (targetUser.userId === fromId) continue;
        try {
          if (message.text) {
            await ctx.telegram.sendMessage(targetUser.userId, message.text);
          } else if (message.photo) {
            const photo = message.photo[message.photo.length - 1].file_id;
            await ctx.telegram.sendPhoto(targetUser.userId, photo, { caption: message.caption || '' });
          } else if (message.document) {
            await ctx.telegram.sendDocument(targetUser.userId, message.document.file_id, { caption: message.caption || '' });
          } else if (message.video) {
            await ctx.telegram.sendVideo(targetUser.userId, message.video.file_id, { caption: message.caption || '' });
          } else if (message.audio) {
            await ctx.telegram.sendAudio(targetUser.userId, message.audio.file_id, { caption: message.caption || '' });
          } else if (message.voice) {
            await ctx.telegram.sendVoice(targetUser.userId, message.voice.file_id);
          } else if (message.sticker) {
            await ctx.telegram.sendSticker(targetUser.userId, message.sticker.file_id);
          } else {
            await ctx.telegram.sendMessage(targetUser.userId, 'Unsupported message type');
          }
          successCount++;
          await new Promise(resolve => setTimeout(resolve, 34));
        } catch (error) {
          console.error(`Broadcast failed for user ${targetUser.userId}:`, error.message);
          failCount++;
        }
      }

      await ctx.reply(
        `📢 Broadcast completed!\n` +
        `✅ Sent to ${successCount} users\n` +
        `❌ Failed for ${failCount} users`
      );
      await BotUser.updateOne({ botToken, userId: fromId }, { step: 'admin_panel' });
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
        await ctx.reply('❌ Invalid URL. Please provide a valid Telegram channel URL (e.g., https://t.me/your_channel).');
        return;
      }

      await ChannelUrl.findOneAndUpdate(
        { botToken },
        { botToken, url: correctedUrl },
        { upsert: true }
      );

      await ctx.reply(`✅ Channel URL has been set to:\n${correctedUrl}`);
      await BotUser.updateOne({ botToken, userId: fromId }, { step: 'admin_panel' });
    } else if (botUser.hasJoined && text !== '/start' && text !== '/panel') {
      if (message.text) {
        await ctx.reply(message.text);
      } else if (message.photo) {
        const photo = message.photo[message.photo.length - 1].file_id;
        await ctx.replyWithPhoto(photo, { caption: message.caption || '' });
      } else if (message.document) {
        await ctx.replyWithDocument(message.document.file_id, { caption: message.caption || '' });
      } else if (message.video) {
        await ctx.replyWithVideo(message.video.file_id, { caption: message.caption || '' });
      } else if (message.audio) {
        await ctx.replyWithAudio(message.audio.file_id, { caption: message.caption || '' });
      } else if (message.voice) {
        await ctx.replyWithVoice(message.voice.file_id);
      } else if (message.sticker) {
        await ctx.replyWithSticker(message.sticker.file_id);
      } else {
        await ctx.reply('Unsupported message type');
      }
    }
  });

  // Add /panel command
  bot.command('panel', async (ctx) => {
    const { botToken } = ctx.state;
    const fromId = ctx.from.id.toString();
    const botInfo = await Bot.findOne({ token: botToken });
    if (fromId !== botInfo.creatorId) {
      await ctx.reply('❌ You are not authorized to access the admin panel.');
      return;
    }
    await ctx.reply('🔧 Admin Panel', adminPanel);
    await BotUser.updateOne({ botToken, userId: fromId }, { step: 'admin_panel' });
  });
};

module.exports = setupCreatedBotHandlers;
