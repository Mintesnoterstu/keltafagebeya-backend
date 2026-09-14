import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse } from '../types';
import {
  notifyNewRequest,
  notifyRequestStatusChange,
} from '../services/telegram.service';
import { logger } from '../config/logger';

export async function createRequest(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const payload = req.body as {
      title: string;
      description: string | null;
      budget: number | null;
      category: string | null;
      urgency: string;
      images: string[];
      price_range?: string | null;
    };

    const productName = payload.title;

    // Support both legacy `title` and schema `product_name` columns
    const insertRow: Record<string, unknown> = {
      user_id: req.user.id,
      status: 'pending',
      description: payload.description,
      category: payload.category,
      urgency: payload.urgency || 'normal',
      images: payload.images || [],
      title: productName,
      product_name: productName,
    };

    if (payload.budget != null) insertRow.budget = payload.budget;
    if (payload.price_range) insertRow.price_range = payload.price_range;

    let { data, error } = await supabase
      .from('requests')
      .insert(insertRow)
      .select()
      .single();

    // Fallback if DB only has product_name (no title) or vice versa
    if (error) {
      logger.warn(`Request insert retry without dual columns: ${error.message}`);
      const fallback = {
        user_id: req.user.id,
        status: 'pending',
        product_name: productName,
        title: productName,
        description: payload.description,
        category: payload.category,
        urgency: payload.urgency || 'normal',
      };
      const retry = await supabase
        .from('requests')
        .insert(fallback)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      logger.error(`Create request failed: ${error?.message}`);
      throw new AppError(error?.message || 'Failed to create request', 500);
    }

    const userName =
      `${req.user.first_name} ${req.user.last_name || ''}`.trim();

    try {
      await notifyNewRequest({
        requestId: data.id,
        productName: data.product_name || data.title || productName,
        customerName: userName,
        username: req.user.username,
        category: data.category,
        urgency: data.urgency,
        description: data.description,
      });
    } catch (notifyErr) {
      logger.error(`Request saved but Telegram notify failed: ${notifyErr}`);
    }

    res.status(201).json({
      success: true,
      message: 'Product request submitted',
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getRequests(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const isAdmin = req.user.role === 'admin';

    let query = supabase
      .from('requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      query = query.eq('user_id', req.user.id);
    }

    const { data, error } = await query;
    if (error) throw new AppError(error.message, 500);

    res.status(200).json({ success: true, data } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getRequestById(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new AppError('Request not found', 404);

    if (data.user_id !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized', 403);
    }

    res.status(200).json({ success: true, data } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function updateRequest(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;
    const { status, admin_notes, assigned_to } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from('requests')
      .select('*, users(telegram_id, id)')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('Request not found', 404);

    const updates: Record<string, unknown> = {
      status,
      admin_notes: admin_notes ?? existing.admin_notes,
      updated_at: new Date().toISOString(),
    };
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;

    const { data, error } = await supabase
      .from('requests')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || 'Failed to update request', 500);
    }

    const user = existing.users as { telegram_id: number; id: string } | null;
    if (user) {
      try {
        await notifyRequestStatusChange(
          user.telegram_id,
          user.id,
          id,
          status
        );
      } catch (e) {
        logger.error(`Request status notify failed: ${e}`);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Request updated',
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}
