import axios from 'axios';
import { env } from './env';
import { logger } from './logger';

/**
 * Verify TELEGRAM_BOT_TOKEN is loaded and belongs to the expected bot.
 * Runs at server start — never prints the full token.
 */
export async function verifyTelegramBotToken(): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    logger.error('TELEGRAM_BOT_TOKEN is missing');
    return;
  }

  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    logger.error(
      'TELEGRAM_BOT_TOKEN has unexpected format (expected 123456:AA...)'
    );
  }

  logger.info(
    `Telegram bot token loaded (bot_id=${env.TELEGRAM_BOT_ID}, length=${token.length})`
  );

  try {
    const { data } = await axios.get(
      `https://api.telegram.org/bot${token}/getMe`,
      { timeout: 10000 }
    );

    if (!data?.ok) {
      logger.error(`Telegram getMe failed: ${JSON.stringify(data)}`);
      return;
    }

    const username = data.result?.username as string | undefined;
    logger.info(
      `Telegram bot OK: @${username} (id=${data.result?.id})`
    );

    const expected = (env.TELEGRAM_BOT_USERNAME || 'keltafagebeyaBot')
      .replace(/^@/, '')
      .toLowerCase();

    if (username && username.toLowerCase() !== expected) {
      logger.error(
        `BOT TOKEN MISMATCH: token belongs to @${username}, but Mini App expects @${expected}. ` +
          `Update Railway TELEGRAM_BOT_TOKEN to the @${expected} token from @BotFather.`
      );
    }
  } catch (err) {
    logger.error(`Telegram getMe error (token may be invalid): ${err}`);
  }
}
