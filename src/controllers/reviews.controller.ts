import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse, OrderItem } from '../types';
import { notifyAdminNewReview } from '../services/telegram.service';
import { logger } from '../config/logger';

async function refreshProductRating(productId: string): Promise<void> {
  const { data, error } = await supabase
    .from('reviews')
    .select('rating')
    .eq('product_id', productId);

  if (error || !data) return;

  const ratings = data.map((r) => Number(r.rating)).filter((n) => !Number.isNaN(n));
  const avg =
    ratings.length > 0
      ? Math.round((ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10) / 10
      : 0;

  const update = await supabase
    .from('products')
    .update({
      rating: avg,
      reviews_count: ratings.length,
    })
    .eq('id', productId);

  if (update.error) {
    logger.warn(`Product rating update skipped: ${update.error.message}`);
  }
}

export async function getProductReviews(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('reviews')
      .select(
        'id, product_id, user_id, rating, comment, created_at, users(id, first_name, last_name, username, photo_url)'
      )
      .eq('product_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      const fallback = await supabase
        .from('reviews')
        .select('*')
        .eq('product_id', id)
        .order('created_at', { ascending: false });
      if (fallback.error) throw new AppError(fallback.error.message, 500);

      res.status(200).json({
        success: true,
        data: fallback.data ?? [],
      } satisfies ApiResponse);
      return;
    }

    res.status(200).json({
      success: true,
      data: data ?? [],
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function createProductReview(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id: productId } = req.params;
    const { rating, comment } = req.body as {
      rating: number;
      comment?: string | null;
    };

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, seller_id')
      .eq('id', productId)
      .maybeSingle();

    if (productError) throw new AppError(productError.message, 500);
    if (!product) throw new AppError('Product not found', 404);

    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, items, status, user_id')
      .eq('user_id', req.user.id)
      .limit(200);

    if (ordersError) {
      logger.warn(`Review purchase check failed: ${ordersError.message}`);
    } else {
      const purchased = (orders ?? []).some(
        (order) =>
          Array.isArray(order.items) &&
          (order.items as OrderItem[]).some(
            (item) => item.product_id === productId
          )
      );
      if (!purchased) {
        throw new AppError(
          'You can only review products you have ordered',
          403
        );
      }
    }

    const row = {
      product_id: productId,
      user_id: req.user.id,
      rating,
      comment: comment ?? null,
    };

    let { data, error } = await supabase
      .from('reviews')
      .upsert(row, { onConflict: 'product_id,user_id' })
      .select()
      .single();

    if (error) {
      const insert = await supabase.from('reviews').insert(row).select().single();
      data = insert.data;
      error = insert.error;
    }

    if (error || !data) {
      logger.error('Review insert failed', {
        message: error?.message,
        code: (error as { code?: string } | undefined)?.code,
        details: (error as { details?: string } | undefined)?.details,
        hint: (error as { hint?: string } | undefined)?.hint,
      });
      throw new AppError(
        error?.message ||
          'Failed to save review. Run sql/005_feedback_reviews.sql in Supabase.',
        500
      );
    }

    await refreshProductRating(productId);

    const customerName =
      `${req.user.first_name} ${req.user.last_name || ''}`.trim();

    try {
      await notifyAdminNewReview({
        customerName,
        username: req.user.username,
        productName: product.name,
        rating,
        comment: comment ?? null,
      });
    } catch (e) {
      logger.error(`Review saved but admin Telegram notify failed: ${e}`);
    }

    res.status(201).json({
      success: true,
      message: 'Review submitted',
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}
