import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse, OrderItem } from '../types';
import {
  notifyRequestStatusChange,
  notifyCustomMessage,
  notifySellerApplicationDecision,
} from '../services/telegram.service';
import { logger } from '../config/logger';

function pagination(page: number, limit: number) {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1, page, limit };
}

export async function getAdminStats(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const [
      pendingRequests,
      pendingApplications,
      ordersCount,
      paidOrders,
    ] = await Promise.all([
      supabase
        .from('requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('seller_applications')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      supabase
        .from('orders')
        .select('total_amount, payment_status, status'),
    ]);

    const revenue = (paidOrders.data ?? [])
      .filter(
        (o) =>
          o.payment_status === 'completed' ||
          o.payment_status === 'paid' ||
          o.status === 'paid' ||
          o.status === 'delivered'
      )
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    const body: ApiResponse = {
      success: true,
      data: {
        pendingRequests: pendingRequests.count ?? 0,
        pendingApplications: pendingApplications.count ?? 0,
        totalOrders: ordersCount.count ?? 0,
        totalRevenue: revenue,
        currency: 'ETB',
      },
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function getAdminRequests(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      status,
      urgency,
      search,
      page = 1,
      limit = 20,
    } = req.query as Record<string, string | number>;
    const { from, to, page: pageNum, limit: limitNum } = pagination(
      Number(page),
      Number(limit)
    );

    let query = supabase
      .from('requests')
      .select(
        '*, users!requests_user_id_fkey(id, first_name, last_name, username, telegram_id, photo_url), assignee:users!requests_assigned_to_fkey(id, first_name, last_name, username)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) query = query.eq('status', status);
    if (urgency) query = query.eq('urgency', urgency);
    if (search) {
      query = query.or(
        `title.ilike.%${search}%,description.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      // Fallback without joins
      logger.warn(`Admin requests join failed: ${error.message}`);
      let fallback = supabase
        .from('requests')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (status) fallback = fallback.eq('status', status);
      const result = await fallback;
      if (result.error) throw new AppError(result.error.message, 500);

      const body: ApiResponse = {
        success: true,
        data: result.data,
        meta: {
          page: pageNum,
          limit: limitNum,
          total: result.count ?? 0,
          totalPages: Math.ceil((result.count ?? 0) / limitNum),
        },
      };
      res.status(200).json(body);
      return;
    }

    const total = count ?? 0;
    res.status(200).json({
      success: true,
      data,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getAdminRequestById(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('requests')
      .select(
        '*, users!requests_user_id_fkey(id, first_name, last_name, username, telegram_id, photo_url, phone), assignee:users!requests_assigned_to_fkey(id, first_name, last_name, username)'
      )
      .eq('id', id)
      .single();

    if (error || !data) {
      const fallback = await supabase
        .from('requests')
        .select('*')
        .eq('id', id)
        .single();
      if (fallback.error || !fallback.data) {
        throw new AppError('Request not found', 404);
      }

      const { data: customer } = await supabase
        .from('users')
        .select('id, first_name, last_name, username, telegram_id, photo_url, phone')
        .eq('id', fallback.data.user_id)
        .single();

      res.status(200).json({
        success: true,
        data: { ...fallback.data, customer },
      } satisfies ApiResponse);
      return;
    }

    res.status(200).json({ success: true, data } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function updateAdminRequest(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { status, admin_notes, assigned_to, urgency } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from('requests')
      .select('*, users(telegram_id, id)')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('Request not found', 404);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (status !== undefined) updates.status = status;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (urgency !== undefined) updates.urgency = urgency;

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
      const user = existing.users as { telegram_id: number; id: string } | null;
      if (user) {
        await notifyRequestStatusChange(
          user.telegram_id,
          user.id,
          id,
          status
        );
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

export async function notifyAdminRequestCustomer(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { message } = req.body;

    const { data: request, error } = await supabase
      .from('requests')
      .select('*, users(telegram_id, id, first_name)')
      .eq('id', id)
      .single();

    if (error || !request) throw new AppError('Request not found', 404);

    const user = request.users as {
      telegram_id: number;
      id: string;
      first_name: string;
    } | null;

    if (!user?.telegram_id) {
      throw new AppError('Customer Telegram ID not found', 400);
    }

    await notifyCustomMessage(
      user.telegram_id,
      user.id,
      message,
      'Request Update'
    );

    res.status(200).json({
      success: true,
      message: 'Notification sent',
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getAdminSellers(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      status,
      search,
      page = 1,
      limit = 20,
    } = req.query as Record<string, string | number>;
    const { from, to, page: pageNum, limit: limitNum } = pagination(
      Number(page),
      Number(limit)
    );

    let query = supabase
      .from('seller_applications')
      .select(
        '*, users!seller_applications_user_id_fkey(id, first_name, last_name, username, telegram_id, photo_url)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) query = query.eq('status', status);
    if (search) {
      query = query.or(
        `business_name.ilike.%${search}%,phone.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      const fallback = await supabase
        .from('seller_applications')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);
      if (fallback.error) throw new AppError(fallback.error.message, 500);

      res.status(200).json({
        success: true,
        data: fallback.data,
        meta: {
          page: pageNum,
          limit: limitNum,
          total: fallback.count ?? 0,
          totalPages: Math.ceil((fallback.count ?? 0) / limitNum),
        },
      } satisfies ApiResponse);
      return;
    }

    const total = count ?? 0;
    res.status(200).json({
      success: true,
      data,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getAdminSellerById(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('seller_applications')
      .select(
        '*, users!seller_applications_user_id_fkey(id, first_name, last_name, username, telegram_id, photo_url, phone, seller_status, role)'
      )
      .eq('id', id)
      .single();

    if (error || !data) {
      const fallback = await supabase
        .from('seller_applications')
        .select('*')
        .eq('id', id)
        .single();
      if (fallback.error || !fallback.data) {
        throw new AppError('Application not found', 404);
      }
      res.status(200).json({
        success: true,
        data: fallback.data,
      } satisfies ApiResponse);
      return;
    }

    res.status(200).json({ success: true, data } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function approveSeller(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);
    const { id } = req.params;

    const { data: application, error } = await supabase
      .from('seller_applications')
      .select('*, users(telegram_id, id)')
      .eq('id', id)
      .single();

    if (error || !application) {
      throw new AppError('Application not found', 404);
    }

    if (application.status === 'approved') {
      throw new AppError('Application already approved', 409);
    }

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from('seller_applications')
      .update({
        status: 'approved',
        reviewed_by: req.user.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      throw new AppError(updateError?.message || 'Failed to approve', 500);
    }

    await supabase
      .from('users')
      .update({
        role: 'seller',
        is_seller: true,
        seller_status: 'approved',
        business_name: application.business_name,
        business_description: application.business_description,
        business_phone: application.phone,
        business_type: application.business_type,
        seller_name: application.business_name,
        seller_bio: application.business_description,
        phone: application.phone,
        updated_at: now,
      })
      .eq('id', application.user_id);

    const user = application.users as { telegram_id: number; id: string } | null;
    if (user) {
      await notifySellerApplicationDecision(user.telegram_id, user.id, true);
    }

    res.status(200).json({
      success: true,
      message: 'Seller application approved',
      data: updated,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function rejectSeller(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);
    const { id } = req.params;
    const { admin_notes } = req.body;

    const { data: application, error } = await supabase
      .from('seller_applications')
      .select('*, users(telegram_id, id)')
      .eq('id', id)
      .single();

    if (error || !application) {
      throw new AppError('Application not found', 404);
    }

    if (application.status === 'rejected') {
      throw new AppError('Application already rejected', 409);
    }

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from('seller_applications')
      .update({
        status: 'rejected',
        admin_notes: admin_notes ?? application.admin_notes,
        reviewed_by: req.user.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !updated) {
      throw new AppError(updateError?.message || 'Failed to reject', 500);
    }

    await supabase
      .from('users')
      .update({
        seller_status: 'rejected',
        admin_notes: admin_notes ?? null,
        updated_at: now,
      })
      .eq('id', application.user_id);

    const user = application.users as { telegram_id: number; id: string } | null;
    if (user) {
      await notifySellerApplicationDecision(
        user.telegram_id,
        user.id,
        false,
        admin_notes
      );
    }

    res.status(200).json({
      success: true,
      message: 'Seller application rejected',
      data: updated,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getAdminOrders(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      status,
      seller_id,
      date_from,
      date_to,
      page = 1,
      limit = 20,
    } = req.query as Record<string, string | number>;
    const pageNum = Number(page);
    const limitNum = Number(limit);

    let query = supabase
      .from('orders')
      .select(
        '*, users!orders_user_id_fkey(id, first_name, last_name, username, telegram_id)'
      )
      .order('created_at', { ascending: false })
      .limit(1000);

    if (status) query = query.eq('status', status);
    if (date_from) query = query.gte('created_at', date_from);
    if (date_to) query = query.lte('created_at', date_to);

    const { data, error } = await query;

    if (error) {
      const fallback = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (fallback.error) throw new AppError(fallback.error.message, 500);

      let filtered = fallback.data ?? [];
      if (seller_id) {
        filtered = filtered.filter(
          (o) =>
            Array.isArray(o.items) &&
            o.items.some((item: OrderItem) => item.seller_id === seller_id)
        );
      }

      const total = filtered.length;
      const from = (pageNum - 1) * limitNum;
      res.status(200).json({
        success: true,
        data: filtered.slice(from, from + limitNum),
        meta: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      } satisfies ApiResponse);
      return;
    }

    let filtered = data ?? [];
    if (seller_id) {
      filtered = filtered.filter(
        (o) =>
          Array.isArray(o.items) &&
          o.items.some((item: OrderItem) => item.seller_id === seller_id)
      );
    }

    const total = filtered.length;
    const from = (pageNum - 1) * limitNum;

    res.status(200).json({
      success: true,
      data: filtered.slice(from, from + limitNum),
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function getAdminOrderById(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('orders')
      .select(
        '*, users!orders_user_id_fkey(id, first_name, last_name, username, telegram_id, phone)'
      )
      .eq('id', id)
      .single();

    if (error || !data) {
      const fallback = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .single();
      if (fallback.error || !fallback.data) {
        throw new AppError('Order not found', 404);
      }

      const sellerIds = Array.from(
        new Set(
          ((fallback.data.items as OrderItem[]) || []).map((i) => i.seller_id)
        )
      );

      const { data: sellers } = await supabase
        .from('users')
        .select('id, first_name, last_name, username, business_name, seller_name')
        .in('id', sellerIds.length ? sellerIds : ['00000000-0000-0000-0000-000000000000']);

      res.status(200).json({
        success: true,
        data: {
          ...fallback.data,
          sellers: sellers ?? [],
          seller_breakdown: groupItemsBySeller(fallback.data.items || []),
        },
      } satisfies ApiResponse);
      return;
    }

    const sellerIds = Array.from(
      new Set(((data.items as OrderItem[]) || []).map((i) => i.seller_id))
    );
    const { data: sellers } = await supabase
      .from('users')
      .select('id, first_name, last_name, username, business_name, seller_name')
      .in('id', sellerIds.length ? sellerIds : ['00000000-0000-0000-0000-000000000000']);

    res.status(200).json({
      success: true,
      data: {
        ...data,
        sellers: sellers ?? [],
        seller_breakdown: groupItemsBySeller(data.items || []),
      },
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

function groupItemsBySeller(items: OrderItem[]) {
  const map = new Map<
    string,
    { seller_id: string; items: OrderItem[]; subtotal: number }
  >();

  for (const item of items) {
    const current = map.get(item.seller_id) || {
      seller_id: item.seller_id,
      items: [],
      subtotal: 0,
    };
    current.items.push(item);
    current.subtotal += item.price * item.quantity;
    map.set(item.seller_id, current);
  }

  return Array.from(map.values());
}
