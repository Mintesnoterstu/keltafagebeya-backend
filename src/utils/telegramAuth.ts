import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { TelegramUser } from '../types';

interface ValidatedTelegramData {
  user: TelegramUser;
  authDate: number;
}

/**
 * Official Mini App validation:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret_key = HMAC_SHA256("WebAppData", bot_token)
 * hash       = HEX(HMAC_SHA256(secret_key, data_check_string))
 */
function computeWebAppHash(botToken: string, dataCheckString: string): string {
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  return crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
}

function buildDataCheckString(
  pairs: Array<[string, string]>,
  omitKeys: Set<string>
): string {
  return pairs
    .filter(([key]) => !omitKeys.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/**
 * Parse initData into key/value pairs without corrupting values.
 * Tries raw string and URI-decoded string.
 */
function parseInitDataCandidates(initData: string): string[] {
  const trimmed = initData.trim();
  const candidates = [trimmed];

  if (trimmed.includes('%')) {
    try {
      candidates.push(decodeURIComponent(trimmed));
    } catch {
      // ignore
    }
  }

  // Some clients send the string double-encoded
  if (trimmed.includes('%25')) {
    try {
      candidates.push(decodeURIComponent(decodeURIComponent(trimmed)));
    } catch {
      // ignore
    }
  }

  return [...new Set(candidates)];
}

function extractPairs(raw: string): Array<[string, string]> | null {
  try {
    // keepBlankValues equivalent
    const params = new URLSearchParams(raw);
    const pairs: Array<[string, string]> = [];
    params.forEach((value, key) => {
      pairs.push([key, value]);
    });
    return pairs.length ? pairs : null;
  } catch {
    return null;
  }
}

/**
 * Validate Telegram Mini App initData using HMAC-SHA256.
 */
export function validateTelegramInitData(initData: string): ValidatedTelegramData {
  if (!initData || typeof initData !== 'string') {
    throw new Error('initData is required');
  }

  const botToken = env.TELEGRAM_BOT_TOKEN;
  const candidates = parseInitDataCandidates(initData);

  // Try several valid data-check-string constructions used in the wild
  const omitVariants: Array<Set<string>> = [
    new Set(['hash']),
    new Set(['hash', 'signature']),
  ];

  let matchedPairs: Array<[string, string]> | null = null;
  let matchedHash: string | null = null;

  for (const raw of candidates) {
    const pairs = extractPairs(raw);
    if (!pairs) continue;

    const providedHash = pairs.find(([k]) => k === 'hash')?.[1];
    if (!providedHash) continue;

    for (const omit of omitVariants) {
      const dataCheckString = buildDataCheckString(pairs, omit);
      const calculated = computeWebAppHash(botToken, dataCheckString);
      if (calculated === providedHash) {
        matchedPairs = pairs;
        matchedHash = providedHash;
        break;
      }
    }
    if (matchedPairs) break;
  }

  if (!matchedPairs || !matchedHash) {
    logger.error(
      `Telegram initData hash mismatch (bot_id=${env.TELEGRAM_BOT_ID}). ` +
        `Confirm Railway TELEGRAM_BOT_TOKEN is exactly the @${env.TELEGRAM_BOT_USERNAME || 'KeltafagebeyaBot'} token from BotFather.`
    );
    throw new Error(
      'Invalid Telegram initData hash — bot token may not match the Mini App bot'
    );
  }

  const map = new Map(matchedPairs);
  const authDate = Number(map.get('auth_date') || 0);
  const maxAge = env.TELEGRAM_AUTH_MAX_AGE_SECONDS;
  if (authDate && maxAge > 0) {
    const age = Date.now() / 1000 - authDate;
    if (age > maxAge) {
      logger.warn(
        `Telegram initData age ${Math.round(age)}s > max ${maxAge}s (hash OK — allowing)`
      );
    }
  }

  const userRaw = map.get('user');
  if (!userRaw) {
    throw new Error('Missing user in initData');
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw new Error('Invalid user JSON in initData');
  }

  if (!user?.id) {
    throw new Error('Invalid user in initData');
  }

  return {
    user,
    authDate: authDate || Math.floor(Date.now() / 1000),
  };
}
