import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { validateTelegramInitData } from '../utils/telegramAuth';
import { AppError } from '../utils/AppError';
import { ApiResponse, JwtPayload, User } from '../types';
import { logger } from '../config/logger';
import { notifyNewUser } from '../services/telegram.service';

async function upsertTelegramUser(telegramUser: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}): Promise<{ user: User; isNew: boolean }> {
  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramUser.id)
    .maybeSingle();

  if (existing) {
    const { data: updated, error } = await supabase
      .from('users')
      .update({
        first_name: telegramUser.first_name,
        last_name: telegramUser.last_name ?? null,
        username: telegramUser.username ?? null,
        photo_url: telegramUser.photo_url ?? existing.photo_url,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error || !updated) {
      throw new AppError(error?.message || 'Failed to update user', 500);
    }
    return { user: updated as User, isNew: false };
  }

  const fullInsert = {
    telegram_id: telegramUser.id,
    first_name: telegramUser.first_name,
    last_name: telegramUser.last_name ?? null,
    username: telegramUser.username ?? null,
    photo_url: telegramUser.photo_url ?? null,
    role: 'customer',
    is_seller: false,
    seller_status: 'none',
  };

  let { data: created, error } = await supabase
    .from('users')
    .insert(fullInsert)
    .select()
    .single();

  // Retry with minimal columns if schema differs
  if (error) {
    logger.warn(`User insert retry (minimal): ${error.message}`);
    const retry = await supabase
      .from('users')
      .insert({
        telegram_id: telegramUser.id,
        first_name: telegramUser.first_name,
        last_name: telegramUser.last_name ?? null,
        username: telegramUser.username ?? null,
      })
      .select()
      .single();
    created = retry.data;
    error = retry.error;
  }

  if (error || !created) {
    logger.error(`User create error: ${error?.message}`);
    throw new AppError(error?.message || 'Failed to create user', 500);
  }

  return { user: created as User, isNew: true };
}

export async function telegramAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const initData = req.body.initData as string;

    let telegramUser: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };

    if (env.isDev && initData === 'dev-bypass') {
      telegramUser = {
        id: 123456789,
        first_name: 'Dev',
        last_name: 'User',
        username: 'devuser',
      };
    } else {
      const validated = validateTelegramInitData(initData);
      telegramUser = validated.user;
    }

    // Auto-promote configured admin telegram id
    const { user, isNew } = await upsertTelegramUser(telegramUser);

    if (
      String(user.telegram_id) === String(env.TELEGRAM_ADMIN_CHAT_ID) &&
      user.role !== 'admin'
    ) {
      await supabase
        .from('users')
        .update({ role: 'admin', updated_at: new Date().toISOString() })
        .eq('id', user.id);
      user.role = 'admin';
    }

    if (isNew) {
      try {
        await notifyNewUser({
          name: `${user.first_name} ${user.last_name || ''}`.trim(),
          username: user.username,
          telegramId: user.telegram_id,
        });
      } catch (e) {
        logger.error(`New user notify failed: ${e}`);
      }
    }

    const payload: JwtPayload = {
      userId: user.id,
      telegramId: user.telegram_id,
      role: user.role,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });

    res.status(200).json({
      success: true,
      message: 'Authenticated successfully',
      data: { user, token, role: user.role },
    } satisfies ApiResponse);
  } catch (err) {
    logger.error(`Telegram auth failed: ${(err as Error).message}`);
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError((err as Error).message || 'Authentication failed', 401));
  }
}

export async function getMe(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }

    res.status(200).json({
      success: true,
      data: req.user,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getConfig(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    res.status(200).json({
      success: true,
      data: {
        stripe_publishable_key: env.STRIPE_PUBLISHABLE_KEY || null,
        telegram_bot_username: env.TELEGRAM_BOT_USERNAME || null,
        frontend_url: env.FRONTEND_URL,
        api_version: '1.0.0',
        build: 'auth-fix-2026-09-15',
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}
