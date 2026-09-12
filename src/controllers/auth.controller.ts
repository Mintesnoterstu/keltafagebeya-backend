import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { env } from '../config/env';
import { validateTelegramInitData } from '../utils/telegramAuth';
import { AppError } from '../utils/AppError';
import { ApiResponse, JwtPayload, User } from '../types';
import { logger } from '../config/logger';

export async function telegramAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { initData } = req.body;

    // In development, allow a bypass for testing without real Telegram data
    let telegramUser;
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

    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramUser.id)
      .maybeSingle();

    let user: User;

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
        throw new AppError('Failed to update user', 500);
      }
      user = updated as User;
    } else {
      const { data: created, error } = await supabase
        .from('users')
        .insert({
          telegram_id: telegramUser.id,
          first_name: telegramUser.first_name,
          last_name: telegramUser.last_name ?? null,
          username: telegramUser.username ?? null,
          photo_url: telegramUser.photo_url ?? null,
          role: 'customer',
          is_seller: false,
          seller_status: 'none',
        })
        .select()
        .single();

      if (error || !created) {
        logger.error(`User create error: ${error?.message}`);
        throw new AppError('Failed to create user', 500);
      }
      user = created as User;
    }

    const payload: JwtPayload = {
      userId: user.id,
      telegramId: user.telegram_id,
      role: user.role,
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30d' });

    const body: ApiResponse = {
      success: true,
      message: 'Authenticated successfully',
      data: { user, token },
    };
    res.status(200).json(body);
  } catch (err) {
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

    const body: ApiResponse = {
      success: true,
      data: req.user,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

/** Public config the frontend needs (publishable keys only — no secrets). */
export async function getConfig(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body: ApiResponse = {
      success: true,
      data: {
        stripe_publishable_key: env.STRIPE_PUBLISHABLE_KEY || null,
        telegram_bot_username: env.TELEGRAM_BOT_USERNAME || null,
        frontend_url: env.FRONTEND_URL,
      },
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
