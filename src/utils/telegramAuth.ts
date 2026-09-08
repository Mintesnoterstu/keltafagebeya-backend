import crypto from 'crypto';
import { env } from '../config/env';
import { TelegramUser } from '../types';

interface ValidatedTelegramData {
  user: TelegramUser;
  authDate: number;
}

/**
 * Validate Telegram Mini App initData using HMAC-SHA256.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(initData: string): ValidatedTelegramData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    throw new Error('Missing hash in initData');
  }

  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(env.TELEGRAM_BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    throw new Error('Invalid Telegram initData hash');
  }

  const authDate = Number(params.get('auth_date'));
  const maxAge = 86400; // 24 hours
  if (!authDate || Date.now() / 1000 - authDate > maxAge) {
    throw new Error('Telegram initData has expired');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('Missing user in initData');
  }

  const user = JSON.parse(userRaw) as TelegramUser;

  return { user, authDate };
}
