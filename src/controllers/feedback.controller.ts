import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse } from '../types';
import { notifyAdminNewFeedback } from '../services/telegram.service';
import { logger } from '../config/logger';

export async function createFeedback(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { category, related_to, message, rating } = req.body as {
      category: string;
      related_to?: string | null;
      message: string;
      rating?: number | null;
    };

    const row = {
      user_id: req.user.id,
      category,
      related_to: related_to ?? null,
      message,
      rating: rating ?? null,
      status: 'new',
    };

    const { data, error } = await supabase
      .from('feedback')
      .insert(row)
      .select()
      .single();

    if (error || !data) {
      logger.error('Feedback insert failed', {
        message: error?.message,
        code: (error as { code?: string } | undefined)?.code,
        details: (error as { details?: string } | undefined)?.details,
        hint: (error as { hint?: string } | undefined)?.hint,
      });
      throw new AppError(
        error?.message ||
          'Failed to save feedback. Run sql/005_feedback_reviews.sql in Supabase.',
        500
      );
    }

    const customerName =
      `${req.user.first_name} ${req.user.last_name || ''}`.trim();

    try {
      await notifyAdminNewFeedback({
        customerName,
        username: req.user.username,
        category,
        message,
        rating: rating ?? null,
      });
    } catch (e) {
      logger.error(`Feedback saved but admin Telegram notify failed: ${e}`);
    }

    res.status(201).json({
      success: true,
      message: 'Feedback submitted',
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}
