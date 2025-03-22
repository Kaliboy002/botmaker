const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const axios = require('axios');

// Initialize Maker Bot
const MAKER_BOT_TOKEN = process.env.MAKER_BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const OWNER_ID = process.env.OWNER_ID;

if (!MAKER_BOT_TOKEN || !MONGO_URI || !OWNER_ID) {
  console.error('Missing environment variables: MAKER_BOT_TOKEN, MONGO_URI, or OWNER_ID');
  process.exit(1);
}

const makerBot = new Telegraf(MAKER_BOT_TOKEN);

// MongoDB Connection
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// MongoDB Schemas
const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  step: { type: String, default: 'none' },
});

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

const User = mongoose.model('User', UserSchema);
const Bot = mongoose.model('Bot', BotSchema);
const BotUser = mongoose.model('BotUser', BotUserSchema);
const ChannelUrl = mongoose.model('ChannelUrl', ChannelUrlSchema);

// Main Menu (Keyboard)
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

// Validate Bot Token
const validateBotToken = async (token) => {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    return response.data.ok ? response.data.result : null;
  } catch (error) {
    console.error('Error validating bot token:', error.message);
    return null;
  }
};

// Set Webhook for Created Bot
const setWebhook = async (token) => {
  const webhookUrl = `https://botmaker-two.vercel.app/created?token=${encodeURIComponent(token)}`;
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

// Delete Webhook
const deleteWebhook = async (token) => {
  try {
    const response = await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook`);
    return response.data.ok;
  } catch (error) {
    console.error('Error deleting webhook:', error.message);
    return false;
  }
};

// /start Command
makerBot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  try {
    await User.findOneAndUpdate(
      { userId },
      { userId, step: 'none' },
      { upsert: true, new: true }
    );
    ctx.reply('Welcome to Bot Maker! Use the buttons below to create and manage your Telegram bots.', mainMenu);
  } catch (error) {
    console.error('Error in /start:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
});

// Create Bot
makerBot.hears('🛠 Create Bot', async (ctx) => {
  const userId = ctx.from.id.toString();
  try {
    ctx.reply('Send your bot token from @BotFather to make your bot:', {
      reply_markup: {
        keyboard: [[{ text: 'Back' }]],
        resize_keyboard: true,
      },
    });
    await User.findOneAndUpdate({ userId }, { step: 'create_bot' });
  } catch (error) {
    console.error('Error in Create Bot:', error);
    ctx.reply('❌ An error occurred. Please try again.', mainMenu);
  }
});

// Delete Bot
makerBot.hears('🗑️ Delete Bot', async (ctx) => {
  const userId = ctx.from.id.toString();
  try {
    ctx.reply('Send your created bot token you want to delete:', {
      reply_markup: {
        keyboard: [[{ text: 'Back' }]],
        resize_keyboard: true,
      },
    });
    await User.findOneAndUpdate({ userId }, { step: 'delete_bot' });
  } catch (error) {
    console.error('Error in Delete Bot:', error);
    ctx.reply('❌ An error occurred. Please try again.', mainMenu);
  }
});

// List My Bots
makerBot.hears('📋 My Bots', async (ctx) => {
  const userId = ctx.from.id.toString();
  try {
    const userBots = await Bot.find({ creatorId: userId });
    let message = '📋 Your Bots:\n\n';
    if (userBots.length === 0) {
      message += 'You have not created any bots yet.';
    } else {
      userBots.forEach((bot) => {
        const createdAt = new Date(bot.createdAt * 1000).toISOString();
        message += `🤖 @${bot.username}\nCreated At: ${createdAt}\n\n`;
      });
    }
    ctx.reply(message, mainMenu);
  } catch (error) {
    console.error('Error in My Bots:', error);
    ctx.reply('❌ An error occurred. Please try again.', mainMenu);
  }
});

// Handle Text Input
makerBot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const text = ctx.message.text;
  try {
    const user = await User.findOne({ userId });
    if (!user) {
      ctx.reply('Please start the bot with /start.', mainMenu);
      return;
    }

    if (text === 'Back') {
      ctx.reply('↩️ Back to main menu.', mainMenu);
      await User.findOneAndUpdate({ userId }, { step: 'none' });
      return;
    }

    if (user.step === 'create_bot') {
      const botInfo = await validateBotToken(text);
      if (!botInfo) {
        ctx.reply('❌ Invalid bot token. Please try again:', {
          reply_markup: { keyboard: [[{ text: 'Back' }]], resize_keyboard: true },
        });
        return;
      }

      const existingBot = await Bot.findOne({ token: text });
      if (existingBot) {
        ctx.reply('❌ This bot token is already in use.', mainMenu);
        await User.findOneAndUpdate({ userId }, { step: 'none' });
        return;
      }

      const webhookSet = await setWebhook(text);
      if (!webhookSet) {
        ctx.reply('❌ Failed to set up the bot. Please try again.', mainMenu);
        await User.findOneAndUpdate({ userId }, { step: 'none' });
        return;
      }

      await Bot.create({
        token: text,
        username: botInfo.username,
        creatorId: userId,
      });

      ctx.reply(
        `✅ Your bot @${botInfo.username} made successfully! Send /panel to manage it.`,
        mainMenu
      );
      await User.findOneAndUpdate({ userId }, { step: 'none' });
    } else if (user.step === 'delete_bot') {
      const bot = await Bot.findOne({ token: text });
      if (!bot) {
        ctx.reply('❌ Bot token not found.', mainMenu);
        await User.findOneAndUpdate({ userId }, { step: 'none' });
        return;
      }

      await deleteWebhook(text);
      await Bot.deleteOne({ token: text });
      await BotUser.deleteMany({ botToken: text });
      await ChannelUrl.deleteOne({ botToken: text });

      ctx.reply('✅ Bot has been deleted and disconnected from Bot Maker.', mainMenu);
      await User.findOneAndUpdate({ userId }, { step: 'none' });
    }
  } catch (error) {
    console.error('Error in text handler:', error);
    ctx.reply('❌ An error occurred. Please try again.', mainMenu);
  }
});

// /clear Command (Owner Only)
makerBot.command('clear', async (ctx) => {
  const userId = ctx.from.id.toString();
  console.log(`Received /clear from userId: ${userId}, OWNER_ID: ${OWNER_ID}`);
  if (userId !== OWNER_ID) {
    console.log('Unauthorized access to /clear');
    ctx.reply('❌ You are not authorized to use this command.');
    return;
  }

  try {
    await Bot.deleteMany({});
    await BotUser.deleteMany({});
    await ChannelUrl.deleteMany({});
    await User.deleteMany({});
    console.log('All data cleared successfully');
    ctx.reply('✅ All data has been cleared. Bot Maker is reset.');
  } catch (error) {
    console.error('Error during /clear:', error);
    ctx.reply('❌ Failed to clear data. Please try again.');
  }
});

// Vercel Handler
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await makerBot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } else {
      res.status(200).send('Bot Maker is running.');
    }
  } catch (error) {
    console.error('Error in maker.js:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};
