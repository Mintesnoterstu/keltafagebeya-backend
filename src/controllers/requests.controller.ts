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
    };

    const { data, error } = await supabase
      .from('requests')
      .insert({
        title: payload.title,
        description: payload.description,
        budget: payload.budget,
        category: payload.category,
        urgency: payload.urgency || 'normal',
        images: payload.images || [],
        user_id: req.user.id,
        status: 'pending',
      })
      .select()
      .single();

    if (error || !data) {
      logger.error(`Create request failed: ${error?.message}`);
      throw new AppError(error?.message || 'Failed to create request', 500);
    }

    const userName =
      `${req.user.first_name} ${req.user.last_name || ''}`.trim();

    // Never fail the API if Telegram is down — log and continue
    try {
      await notifyNewRequest(data.id, data.title, userName, {
        urgency: data.urgency,
        description: data.description,
        category: data.category,
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

    const body: ApiResponse = { success: true, data };
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

    const body: ApiResponse = { success: true, data };
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
      await notifyRequestStatusChange(
        user.telegram_id,
        user.id,
        id,
        status
      );
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
