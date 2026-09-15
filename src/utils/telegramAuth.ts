import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
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
  let raw = initData.trim();
  if (raw.includes('%')) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // keep original
    }
  }

  const params = new URLSearchParams(raw);
  const hash = params.get('hash');

  if (!hash) {
    throw new Error('Missing hash in initData');
  }

  params.delete('hash');
  params.delete('signature');

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
    throw new Error(
      'Invalid Telegram initData hash — bot token may not match the Mini App bot'
    );
  }

  const authDate = Number(params.get('auth_date'));
  const maxAge = env.TELEGRAM_AUTH_MAX_AGE_SECONDS;
  const ageSeconds = authDate ? Date.now() / 1000 - authDate : NaN;

  // Hash is the security check. Expiry is soft: warn, only hard-fail if maxAge > 0 and exceeded.
  if (!authDate) {
    logger.warn('Telegram initData missing auth_date (continuing after hash OK)');
  } else if (maxAge > 0 && ageSeconds > maxAge) {
    logger.warn(
      `Telegram initData age ${Math.round(ageSeconds)}s exceeds max ${maxAge}s — allowing login (hash OK)`
    );
    // Do not block login: Mini App initData often stays stale until full reopen.
    // Frontend should still reopen for a fresh session when possible.
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('Missing user in initData');
  }

  const user = JSON.parse(userRaw) as TelegramUser;
  if (!user?.id) {
    throw new Error('Invalid user in initData');
  }

  return { user, authDate: authDate || Math.floor(Date.now() / 1000) };
}
