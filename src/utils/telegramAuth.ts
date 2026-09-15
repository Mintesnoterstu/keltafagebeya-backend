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
  // Frontend may send already-decoded or still-encoded strings
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

  // Also ignore signature field used by Login Widget (not Mini App)
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
  // Mini Apps often keep a session open; allow up to 7 days
  const maxAge = 7 * 86400;
  if (!authDate || Date.now() / 1000 - authDate > maxAge) {
    throw new Error('Telegram initData has expired — close and reopen the Mini App');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('Missing user in initData');
  }

  const user = JSON.parse(userRaw) as TelegramUser;
  if (!user?.id) {
    throw new Error('Invalid user in initData');
  }

  return { user, authDate };
}
