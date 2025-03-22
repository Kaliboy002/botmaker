const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Bot token for the maker bot (replace with your token from @BotFather)
const MAKER_BOT_TOKEN = process.env.MAKER_BOT_TOKEN || '7642117837:AAFOFHahLST1wW0rEbphc_W9uMoxrHsgacA';

if (!MAKER_BOT_TOKEN) {
  console.error('Maker bot token not configured. Please set the MAKER_BOT_TOKEN environment variable.');
  process.exit(1);
}

// Initialize the maker bot
const makerBot = new Telegraf(MAKER_BOT_TOKEN);

// File paths for JSON storage (use /tmp for Vercel)
const DATA_DIR = '/tmp/telegram-bot-maker';
const USER_FILE = path.join(DATA_DIR, 'users.json');
const BOTS_FILE = path.join(DATA_DIR, 'bots.json');
const BOT_USERS_FILE = path.join(DATA_DIR, 'bot_users.json');
const CHANNEL_URLS_FILE = path.join(DATA_DIR, 'channel_urls.json');

// Ensure the data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (error) {
  console.error('Failed to create data directory:', error);
  process.exit(1);
}

// Initialize JSON files if they don't exist
const initializeFile = (filePath, defaultValue) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue));
  }
};

initializeFile(USER_FILE, {});
initializeFile(BOTS_FILE, {});
initializeFile(BOT_USERS_FILE, {});
initializeFile(CHANNEL_URLS_FILE, {});

// Load data from JSON files
const loadData = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Error loading data from ${filePath}:`, error);
    return {};
  }
};

const saveData = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error saving data to ${filePath}:`, error);
  }
};

let users = loadData(USER_FILE);
let bots = loadData(BOTS_FILE);
let botUsers = loadData(BOT_USERS_FILE);
let channelUrls = loadData(CHANNEL_URLS_FILE);

// Main menu for the maker bot
const mainMenu = {
  reply_markup: {
    keyboard: [
      [{ text: '🛠 Create Bot' }],
      [{ text: '🗑️ Delete Bot' }],
      [{ text: '📋 My Bots' }],
    ],
    resize_keyboard: true,
  },
};

// Admin panel keyboard
const adminPanel = {
  reply_markup: {
    keyboard: [
      [{ text: '📊 Statistics' }],
      [{ text: '📍 Broadcast' }],
      [{ text: '🔗 Set Channel URL' }],
      [{ text: 'Back to Bot List' }],
    ],
    resize_keyboard: true,
  },
};

// Cancel keyboard
const cancelKeyboard = {
  reply_markup: {
    keyboard: [[{ text: 'Cancel' }]],
    resize_keyboard: true,
  },
};

// Function to validate Telegram bot token
const validateBotToken = async (token) => {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    return response.data.ok ? response.data.result : null;
  } catch (error) {
    console.error('Error validating bot token:', error.message);
    return null;
  }
};

// Function to set webhook for a created bot
const setWebhook = async (token) => {
  const webhookUrl = `https://${process.env.VERCEL_URL}/bot?token=${encodeURIComponent(token)}`;
  try {
    const response = await axios.get(`https://api.telegram.org/bot${token}/setWebhook`, {
      params: { url: webhookUrl },
    });
    return response.data.ok;
  } catch (error) {
    console.error('Error setting webhook:', error.message);
    return false;
  }
};

// Function to delete webhook for a created bot
const deleteWebhook = async (token) => {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook`);
    return response.data.ok;
  } catch (error) {
    console.error('Error deleting webhook:', error.message);
    return false;
  }
};

// Maker Bot: Handle /start
makerBot.start((ctx) => {
  const fromId = ctx.from.id.toString();
  users[fromId] = { step: 'none' };
  saveData(USER_FILE, users);
  ctx.reply('Welcome to Bot Maker! Use the buttons below to create and manage your Telegram bots.', mainMenu);
});

// Maker Bot: Create Bot
makerBot.hears('🛠 Create Bot', (ctx) => {
  const fromId = ctx.from.id.toString();
  ctx.reply('Processing your request to create a bot...');
  ctx.reply('Please send your bot token (from @BotFather) to create your bot:', {
    reply_markup: {
      keyboard: [[{ text: 'Back' }]],
      resize_keyboard: true,
    },
  });
  users[fromId] = { step: 'create_bot' };
  saveData(USER_FILE, users);
});

// Maker Bot: Handle bot token for creation
makerBot.on('text', async (ctx) => {
  const fromId = ctx.from.id.toString();
  const text = ctx.message.text;

  if (!users[fromId]) users[fromId] = { step: 'none' };

  if (users[fromId].step === 'create_bot') {
    if (text === 'Back') {
      ctx.reply('↩️ Back to main menu.', mainMenu);
      users[fromId].step = 'none';
      saveData(USER_FILE, users);
      return;
    }

    // Check if the token is already used
    let tokenExists = false;
    for (const userId in bots) {
      if (bots[userId].some((bot) => bot.token === text)) {
        tokenExists = true;
        break;
      }
    }

    if (tokenExists) {
      ctx.reply('❌ Error: This bot token is already saved and created.', mainMenu);
      users[fromId].step = 'none';
      saveData(USER_FILE, users);
      return;
    }

    // Validate the token
    const botInfo = await validateBotToken(text);
    if (!botInfo) {
      ctx.reply('❌ Error: Invalid bot token. Please obtain a valid token from @BotFather.', {
        reply_markup: {
          keyboard: [[{ text: 'Back' }]],
          resize_keyboard: true,
        },
      });
      return;
    }

    // Set webhook
    const webhookSet = await setWebhook(text);
    if (!webhookSet) {
      ctx.reply('❌ Failed to set up the bot. Please ensure the token is valid and try again.', mainMenu);
      users[fromId].step = 'none';
      saveData(USER_FILE, users);
      return;
    }

    // Save bot info
    if (!bots[fromId]) bots[fromId] = [];
    bots[fromId].push({
      token: text,
      username: botInfo.username,
      creator_id: fromId,
      created_at: Math.floor(Date.now() / 1000),
    });
    saveData(BOTS_FILE, bots);

    ctx.reply(
      `✅ Bot @${botInfo.username} has been successfully created!\n\n` +
      `You can now interact with your bot by clicking here: t.me/${botInfo.username}\n` +
      `To manage your bot, send /panel to your created bot.`,
      mainMenu
    );
    users[fromId].step = 'none';
    saveData(USER_FILE, users);
  } else if (users[fromId].step === 'delete_bot') {
    if (text === 'Back') {
      ctx.reply('↩️ Back to main menu.', mainMenu);
      users[fromId].step = 'none';
      saveData(USER_FILE, users);
      return;
    }

    // Check if the token exists
    let tokenFound = false;
    let botCreatorId = null;
    let botIndex = null;
    for (const userId in bots) {
      const index = bots[userId].findIndex((bot) => bot.token === text);
      if (index !== -1) {
        tokenFound = true;
        botCreatorId = userId;
        botIndex = index;
        break;
      }
    }

    if (!tokenFound) {
      ctx.reply('❌ Bot token not found.', mainMenu);
      users[fromId].step = 'none';
      saveData(USER_FILE, users);
      return;
    }

    // Delete the bot's webhook
    await deleteWebhook(text);

    // Remove the bot from bots.json
    bots[botCreatorId].splice(botIndex, 1);
    if (bots[botCreatorId].length === 0) delete bots[botCreatorId];
    saveData(BOTS_FILE, bots);

    // Clear bot's user data and channel URL
    if (botUsers[text]) {
      delete botUsers[text];
      saveData(BOT_USERS_FILE, botUsers);
    }
    if (channelUrls[text]) {
      delete channelUrls[text];
      saveData(CHANNEL_URLS_FILE, channelUrls);
    }

    ctx.reply('✅ Bot has been deleted and is no longer connected to Bot Maker.', mainMenu);
    users[fromId].step = 'none';
    saveData(USER_FILE, users);
  }
});

// Maker Bot: Delete Bot
makerBot.hears('🗑️ Delete Bot', (ctx) => {
  const fromId = ctx.from.id.toString();
  ctx.reply('Processing your request to delete a bot...');
  ctx.reply('Please send the bot token of the bot you want to delete:', {
    reply_markup: {
      keyboard: [[{ text: 'Back' }]],
      resize_keyboard: true,
    },
  });
  users[fromId] = { step: 'delete_bot' };
  saveData(USER_FILE, users);
});

// Maker Bot: List My Bots
makerBot.hears('📋 My Bots', (ctx) => {
  const fromId = ctx.from.id.toString();
  const botList = bots[fromId] || [];
  let message = '📋 Your Bots:\n\n';
  if (botList.length === 0) {
    message += 'You have not created any bots yet.';
  } else {
    botList.forEach((bot) => {
      message += `🤖 @${bot.username}\n`;
    });
    message += '\nSelect a bot to manage:';
    const keyboard = botList.map((bot, index) => [{ text: `Manage @${bot.username}`, callback_data: `manage_${index}` }]);
    keyboard.push([{ text: 'Back', callback_data: 'back_to_main' }]);
    ctx.reply(message, {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    });
    users[fromId].step = 'select_bot';
    saveData(USER_FILE, users);
  }
});

// Maker Bot: Handle bot selection for management
makerBot.on('callback_query', async (ctx) => {
  const fromId = ctx.from.id.toString();
  const data = ctx.callbackQuery.data;

  if (data === 'back_to_main') {
    ctx.reply('↩️ Back to main menu.', mainMenu);
    users[fromId].step = 'none';
    saveData(USER_FILE, users);
    await ctx.answerCbQuery();
    return;
  }

  if (data.startsWith('manage_')) {
    const botIndex = parseInt(data.split('_')[1], 10);
    if (!bots[fromId] || !bots[fromId][botIndex]) {
      ctx.reply('❌ Error: Bot not found. Please select a bot again.', mainMenu);
      users[fromId].step = 'none';
      saveData(USER_FILE, users);
      await ctx.answerCbQuery();
      return;
    }

    users[fromId].selected_bot_index = botIndex;
    users[fromId].step = 'admin_panel';
    saveData(USER_FILE, users);

    const botInfo = bots[fromId][botIndex];
    ctx.reply(`🔧 Admin Panel for @${botInfo.username}`, adminPanel);
    await ctx.answerCbQuery();
  }
});

// Maker Bot: Admin Panel Commands
makerBot.hears('📊 Statistics', async (ctx) => {
  const fromId = ctx.from.id.toString();
  if (users[fromId].step !== 'admin_panel') return;

  const botIndex = users[fromId].selected_bot_index;
  if (!bots[fromId] || !bots[fromId][botIndex]) {
    ctx.reply('❌ Error: Bot not found. Please select a bot again.', mainMenu);
    users[fromId].step = 'none';
    delete users[fromId].selected_bot_index;
    saveData(USER_FILE, users);
    return;
  }

  const selectedBot = bots[fromId][botIndex];
  const botToken = selectedBot.token;
  const botUsername = selectedBot.username;

  const userCount = Object.values(botUsers[botToken] || {}).filter((user) => user.has_joined).length;
  const createdAt = selectedBot.created_at ? new Date(selectedBot.created_at * 1000).toISOString() : 'Unknown';
  const message = `📊 Statistics for @${botUsername}\n\n` +
                 `👥 Total Users: ${userCount}\n` +
                 `📅 Bot Created: ${createdAt}\n`;
  ctx.reply(message, adminPanel);
});

makerBot.hears('📍 Broadcast', (ctx) => {
  const fromId = ctx.from.id.toString();
  if (users[fromId].step !== 'admin_panel') return;

  const botIndex = users[fromId].selected_bot_index;
  if (!bots[fromId] || !bots[fromId][botIndex]) {
    ctx.reply('❌ Error: Bot not found. Please select a bot again.', mainMenu);
    users[fromId].step = 'none';
    delete users[fromId].selected_bot_index;
    saveData(USER_FILE, users);
    return;
  }

  const selectedBot = bots[fromId][botIndex];
  const botToken = selectedBot.token;
  const botUsername = selectedBot.username;

  const userCount = Object.values(botUsers[botToken] || {}).filter((user) => user.has_joined).length;
  if (userCount === 0) {
    ctx.reply(`❌ No users have started @${botUsername} yet.`, adminPanel);
    return;
  }

  ctx.reply(`📢 Enter the message to broadcast to ${userCount} users of @${botUsername}:`, cancelKeyboard);
  users[fromId].step = 'broadcast';
  saveData(USER_FILE, users);
});

makerBot.hears('🔗 Set Channel URL', (ctx) => {
  const fromId = ctx.from.id.toString();
  if (users[fromId].step !== 'admin_panel') return;

  const botIndex = users[fromId].selected_bot_index;
  if (!bots[fromId] || !bots[fromId][botIndex]) {
    ctx.reply('❌ Error: Bot not found. Please select a bot again.', mainMenu);
    users[fromId].step = 'none';
    delete users[fromId].selected_bot_index;
    saveData(USER_FILE, users);
    return;
  }

  const selectedBot = bots[fromId][botIndex];
  const botToken = selectedBot.token;
  const botUsername = selectedBot.username;

  const currentUrl = channelUrls[botToken] || 'https://t.me/Kali_Linux_BOTS (default)';
  ctx.reply(
    `🔗 Current Channel URL for @${botUsername}:\n${currentUrl}\n\n` +
    `Please send the new channel URL (e.g., https://t.me/your_channel):`,
    cancelKeyboard
  );
  users[fromId].step = 'set_channel_url';
  saveData(USER_FILE, users);
});

makerBot.hears('Back to Bot List', (ctx) => {
  const fromId = ctx.from.id.toString();
  if (users[fromId].step !== 'admin_panel') return;

  const botList = bots[fromId] || [];
  let message = '📋 Select a bot to manage:\n\n';
  if (botList.length === 0) {
    message = 'You have not created any bots yet.';
    ctx.reply(message, mainMenu);
    users[fromId].step = 'none';
    delete users[fromId].selected_bot_index;
    saveData(USER_FILE, users);
    return;
  }

  const keyboard = botList.map((bot, index) => [{ text: `Manage @${bot.username}`, callback_data: `manage_${index}` }]);
  keyboard.push([{ text: 'Back', callback_data: 'back_to_main' }]);
  ctx.reply(message, {
    reply_markup: {
      inline_keyboard: keyboard,
    },
  });
  users[fromId].step = 'select_bot';
  saveData(USER_FILE, users);
});

// Maker Bot: Handle Broadcast
makerBot.on('message', async (ctx) => {
  const fromId = ctx.from.id.toString();
  const message = ctx.message;

  if (users[fromId].step === 'broadcast') {
    if (message.text === 'Cancel') {
      ctx.reply('↩️ Broadcast cancelled.', adminPanel);
      users[fromId].step = 'admin_panel';
      saveData(USER_FILE, users);
      return;
    }

    const botIndex = users[fromId].selected_bot_index;
    if (!bots[fromId] || !bots[fromId][botIndex]) {
      ctx.reply('❌ Error: Bot not found. Please select a bot again.', mainMenu);
      users[fromId].step = 'none';
      delete users[fromId].selected_bot_index;
      saveData(USER_FILE, users);
      return;
    }

    const selectedBot = bots[fromId][botIndex];
    const botToken = selectedBot.token;
    const botUsername = selectedBot.username;

    const targetUsers = Object.entries(botUsers[botToken] || {}).filter(([_, user]) => user.has_joined);
    let successCount = 0;
    let failCount = 0;

    for (const [userId] of targetUsers) {
      try {
        await ctx.telegram.forwardMessage(userId, ctx.chat.id, message.message_id, { token: botToken });
        successCount++;
      } catch (error) {
        console.error(`Failed to broadcast to user ${userId}:`, error.message);
        failCount++;
      }
    }

    ctx.reply(
      `📢 Broadcast completed for @${botUsername}!\n` +
      `✅ Sent to ${successCount} users\n` +
      `❌ Failed for ${failCount} users`,
      adminPanel
    );
    users[fromId].step = 'admin_panel';
    saveData(USER_FILE, users);
  } else if (users[fromId].step === 'set_channel_url') {
    const text = message.text;
    if (text === 'Cancel') {
      ctx.reply('↩️ Channel URL setting cancelled.', adminPanel);
      users[fromId].step = 'admin_panel';
      saveData(USER_FILE, users);
      return;
    }

    const botIndex = users[fromId].selected_bot_index;
    if (!bots[fromId] || !bots[fromId][botIndex]) {
      ctx.reply('❌ Error: Bot not found. Please select a bot again.', mainMenu);
      users[fromId].step = 'none';
      delete users[fromId].selected_bot_index;
      saveData(USER_FILE, users);
      return;
    }

    const selectedBot = bots[fromId][botIndex];
    const botToken = selectedBot.token;
    const botUsername = selectedBot.username;

    // Advanced URL correction
    let inputUrl = text.trim();
    inputUrl = inputUrl.replace(/^(https?:\/\/)?/i, '');
    inputUrl = inputUrl.replace(/\/+$/, '');
    if (!/^t\.me\//i.test(inputUrl)) {
      inputUrl = 't.me/' + inputUrl;
    }
    const correctedUrl = 'https://' + inputUrl;

    // Validate URL
    const urlRegex = /^https:\/\/t\.me\/.+$/;
    if (!urlRegex.test(correctedUrl)) {
      ctx.reply('❌ Invalid URL. Please provide a valid Telegram channel URL (e.g., https://t.me/your_channel).', cancelKeyboard);
      return;
    }

    channelUrls[botToken] = correctedUrl;
    saveData(CHANNEL_URLS_FILE, channelUrls);

    ctx.reply(`✅ Channel URL for @${botUsername} has been set to:\n${correctedUrl}`, adminPanel);
    users[fromId].step = 'admin_panel';
    saveData(USER_FILE, users);
  }
});

// Created Bots: Handle updates via webhook
const handleCreatedBotUpdate = async (req, res) => {
  const botToken = req.query.token;
  if (!botToken) {
    res.status(400).json({ error: 'No token provided' });
    return;
  }

  // Find the creator of this bot
  let creatorId = null;
  for (const userId in bots) {
    if (bots[userId].some((bot) => bot.token === botToken)) {
      creatorId = userId;
      break;
    }
  }

  if (!creatorId) {
    res.status(404).json({ error: 'Bot not found' });
    return;
  }

  const bot = new Telegraf(botToken);

  // Process the update
  const update = req.body;
  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  const fromId = (update.message?.from?.id || update.callback_query?.from?.id)?.toString();
  const text = update.message?.text;
  const message = update.message;
  const messageId = update.message?.message_id;

  if (!chatId || !fromId) {
    res.status(400).json({ error: 'Invalid update' });
    return;
  }

  // Initialize user data for this bot
  if (!botUsers[botToken]) botUsers[botToken] = {};
  if (!botUsers[botToken][fromId]) {
    botUsers[botToken][fromId] = { has_joined: false, step: 'none' };
  }
  saveData(BOT_USERS_FILE, botUsers);

  const channelUrl = channelUrls[botToken] || 'https://t.me/Kali_Linux_BOTS';

  // Handle /start
  if (text === '/start') {
    if (botUsers[botToken][fromId].has_joined) {
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
    botUsers[botToken][fromId].step = 'none';
    saveData(BOT_USERS_FILE, botUsers);
  }

  // Handle "Joined" callback
  if (update.callback_query?.data === 'joined') {
    const callbackQuery = update.callback_query;
    botUsers[botToken][fromId].has_joined = true;
    saveData(BOT_USERS_FILE, botUsers);

    await bot.telegram.answerCallbackQuery(callbackQuery.id, { text: 'Thank you for joining!' });
    await bot.telegram.sendMessage(chatId, 'Hi, how are you?');
  }

  // Handle /panel (admin panel for bot creator)
  if (text === '/panel' && fromId === creatorId) {
    await bot.telegram.sendMessage(chatId, '🔧 Admin Panel', adminPanel);
    botUsers[botToken][fromId].step = 'admin_panel';
    saveData(BOT_USERS_FILE, botUsers);
  }

  // Handle admin panel commands
  if (botUsers[botToken][fromId].step === 'admin_panel') {
    if (text === '📊 Statistics') {
      const userCount = Object.values(botUsers[botToken] || {}).filter((user) => user.has_joined).length;
      const botInfo = bots[creatorId].find((b) => b.token === botToken);
      const createdAt = botInfo.created_at ? new Date(botInfo.created_at * 1000).toISOString() : 'Unknown';
      const message = `📊 Statistics\n\n` +
                     `👥 Total Users: ${userCount}\n` +
                     `📅 Bot Created: ${createdAt}\n`;
      await bot.telegram.sendMessage(chatId, message, adminPanel);
    } else if (text === '📍 Broadcast') {
      const userCount = Object.values(botUsers[botToken] || {}).filter((user) => user.has_joined).length;
      if (userCount === 0) {
        await bot.telegram.sendMessage(chatId, '❌ No users have started this bot yet.', adminPanel);
      } else {
        await bot.telegram.sendMessage(chatId, `📢 Please send the message to broadcast to ${userCount} users (you can send text, media, files, etc.):`, cancelKeyboard);
        botUsers[botToken][fromId].step = 'broadcast';
        saveData(BOT_USERS_FILE, botUsers);
      }
    } else if (text === '🔗 Set Channel URL') {
      const currentUrl = channelUrls[botToken] || 'https://t.me/Kali_Linux_BOTS (default)';
      await bot.telegram.sendMessage(chatId,
        `🔗 Current Channel URL:\n${currentUrl}\n\n` +
        `Please send the new channel URL (e.g., https://t.me/your_channel):`,
        cancelKeyboard
      );
      botUsers[botToken][fromId].step = 'set_channel_url';
      saveData(BOT_USERS_FILE, botUsers);
    } else if (text === 'Back to Bot List') {
      const botList = bots[creatorId] || [];
      let message = '📋 Select a bot to manage:\n\n';
      if (botList.length === 0) {
        message = 'You have not created any bots yet.';
        await bot.telegram.sendMessage(chatId, message, mainMenu);
        botUsers[botToken][fromId].step = 'none';
        saveData(BOT_USERS_FILE, botUsers);
        return;
      }

      const keyboard = botList.map((bot, index) => [{ text: `Manage @${bot.username}`, callback_data: `manage_${index}` }]);
      keyboard.push([{ text: 'Back', callback_data: 'back_to_main' }]);
      await bot.telegram.sendMessage(chatId, message, {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
      botUsers[botToken][fromId].step = 'select_bot';
      saveData(BOT_USERS_FILE, botUsers);
    }
  }

  // Handle broadcast
  if (botUsers[botToken][fromId].step === 'broadcast') {
    if (text === 'Cancel') {
      await bot.telegram.sendMessage(chatId, '↩️ Broadcast cancelled.', adminPanel);
      botUsers[botToken][fromId].step = 'admin_panel';
      saveData(BOT_USERS_FILE, botUsers);
      return;
    }

    const targetUsers = Object.entries(botUsers[botToken] || {}).filter(([userId, user]) => user.has_joined && userId !== fromId);
    let successCount = 0;
    let failCount = 0;

    for (const [userId] of targetUsers) {
      try {
        if (message.text) {
          await bot.telegram.sendMessage(userId, message.text);
        } else if (message.photo) {
          const photo = message.photo[message.photo.length - 1].file_id;
          await bot.telegram.sendPhoto(userId, photo, { caption: message.caption || '' });
        } else if (message.document) {
          await bot.telegram.sendDocument(userId, message.document.file_id, { caption: message.caption || '' });
        } else if (message.video) {
          await bot.telegram.sendVideo(userId, message.video.file_id, { caption: message.caption || '' });
        } else if (message.audio) {
          await bot.telegram.sendAudio(userId, message.audio.file_id, { caption: message.caption || '' });
        } else if (message.voice) {
          await bot.telegram.sendVoice(userId, message.voice.file_id);
        } else if (message.sticker) {
          await bot.telegram.sendSticker(userId, message.sticker.file_id);
        } else {
          await bot.telegram.sendMessage(userId, 'Unsupported message type');
        }
        successCount++;
      } catch (error) {
        console.error(`Failed to broadcast to user ${userId}:`, error.message);
        failCount++;
      }
    }

    await bot.telegram.sendMessage(chatId,
      `📢 Broadcast completed!\n` +
      `✅ Sent to ${successCount} users\n` +
      `❌ Failed for ${failCount} users`,
      adminPanel
    );
    botUsers[botToken][fromId].step = 'admin_panel';
    saveData(BOT_USERS_FILE, botUsers);
  }

  // Handle set channel URL
  if (botUsers[botToken][fromId].step === 'set_channel_url') {
    if (text === 'Cancel') {
      await bot.telegram.sendMessage(chatId, '↩️ Channel URL setting cancelled.', adminPanel);
      botUsers[botToken][fromId].step = 'admin_panel';
      saveData(BOT_USERS_FILE, botUsers);
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

    channelUrls[botToken] = correctedUrl;
    saveData(CHANNEL_URLS_FILE, channelUrls);

    await bot.telegram.sendMessage(chatId, `✅ Channel URL has been set to:\n${correctedUrl}`, adminPanel);
    botUsers[botToken][fromId].step = 'admin_panel';
    saveData(BOT_USERS_FILE, botUsers);
  }

  // Handle regular messages from users
  if (botUsers[botToken][fromId].has_joined && botUsers[botToken][fromId].step === 'none' && text !== '/start' && text !== '/panel') {
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

  res.status(200).json({ ok: true });
};

// Vercel handler
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const botToken = req.query.token;
      if (botToken) {
        // Handle updates for created bots
        await handleCreatedBotUpdate(req, res);
      } else {
        // Handle updates for the maker bot
        await makerBot.handleUpdate(req.body);
        res.status(200).json({ ok: true });
      }
    } else {
      res.status(200).send('Bot is running.');
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};
