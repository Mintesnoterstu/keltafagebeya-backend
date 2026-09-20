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
      product_name: string;
      description: string | null;
      budget: number | null;
      price_range: string | null;
      category: string | null;
      urgency: string;
      contact_phone: string | null;
      images: string[];
    };

    const productName = payload.product_name;

    // Live schema: product_name (NO title column)
    const insertAttempts: Record<string, unknown>[] = [
      {
        user_id: req.user.id,
        product_name: productName,
        description: payload.description,
        category: payload.category,
        urgency: payload.urgency || 'normal',
        status: 'pending',
        contact_phone: payload.contact_phone,
        price_range: payload.price_range,
        budget: payload.budget,
        images: payload.images || [],
      },
      {
        user_id: req.user.id,
        product_name: productName,
        description: payload.description,
        category: payload.category,
        urgency: payload.urgency || 'normal',
        status: 'pending',
        contact_phone: payload.contact_phone,
        price_range: payload.price_range,
      },
      {
        user_id: req.user.id,
        product_name: productName,
        description: payload.description,
        category: payload.category,
        urgency: payload.urgency || 'normal',
        status: 'pending',
      },
    ];

    let data: Record<string, unknown> | null = null;
    let lastError: string | null = null;

    for (const row of insertAttempts) {
      const result = await supabase.from('requests').insert(row).select().single();
      if (!result.error && result.data) {
        data = result.data as Record<string, unknown>;
        lastError = null;
        break;
      }
      lastError = result.error?.message || 'insert failed';
      logger.warn(`Request insert attempt failed: ${lastError}`);
    }

    if (!data) {
      logger.error(`Create request failed: ${lastError}`);
      throw new AppError(lastError || 'Failed to create request', 500);
    }

    const userName =
      `${req.user.first_name} ${req.user.last_name || ''}`.trim();

    try {
      await notifyNewRequest({
        requestId: String(data.id),
        productName: String(data.product_name || productName),
        customerName: userName,
        username: req.user.username,
        category: (data.category as string) || payload.category,
        urgency: (data.urgency as string) || payload.urgency,
        description: (data.description as string) || payload.description,
      });
    } catch (notifyErr) {
      logger.error(`Request saved but Telegram notify failed: ${notifyErr}`);
    }

    const body: ApiResponse = {
      success: true,
      message: 'Product request submitted',
      data,
    };
    res.status(201).json(body);
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

    const body: ApiResponse = {
      success: true,
      data: data ?? [],
    };
    res.status(200).json(body);
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

    const body: ApiResponse = {
      success: true,
      data,
    };
    res.status(200).json(body);
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
    if (req.user.role !== 'admin') {
      throw new AppError('Admin access required', 403);
    }

    const { id } = req.params;
    const { status, admin_notes, assigned_to } = req.body;

    const { data: existing, error: findError } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !existing) throw new AppError('Request not found', 404);

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;
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

    if (status && status !== existing.status) {
      try {
        const { data: owner } = await supabase
          .from('users')
          .select('telegram_id, id')
          .eq('id', existing.user_id)
          .maybeSingle();
        if (owner?.telegram_id) {
          await notifyRequestStatusChange(
            owner.telegram_id,
            owner.id,
            id,
            status
          );
        }
      } catch (e) {
        logger.error(`Request status notify failed: ${e}`);
      }
    }

    const body: ApiResponse = {
      success: true,
      message: 'Request updated',
      data,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
