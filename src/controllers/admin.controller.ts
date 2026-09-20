import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse, OrderItem } from '../types';
import {
  notifyCustomMessage,
  notifySellerApplicationDecision,
  notifyOrderStatusChange,
} from '../services/telegram.service';
import { logger } from '../config/logger';
import { normalizeOrderForClient } from '../utils/normalizeOrder';

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
    const { status, admin_notes, assigned_to, urgency } = req.body || {};

    const { data: existing, error: fetchError } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      logger.error('Admin request fetch failed', {
        message: fetchError.message,
        code: (fetchError as { code?: string }).code,
        details: (fetchError as { details?: string }).details,
        hint: (fetchError as { hint?: string }).hint,
      });
      throw new AppError(fetchError.message, 500);
    }
    if (!existing) throw new AppError('Request not found', 404);

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (urgency !== undefined) updates.urgency = urgency;
    updates.updated_at = new Date().toISOString();

    let data: Record<string, unknown> | null = null;
    let lastError: { message: string; code?: string; details?: string; hint?: string } | null =
      null;

    for (const row of [
      updates,
      Object.fromEntries(
        Object.entries(updates).filter(([k]) => k !== 'updated_at')
      ),
      {
        ...(status !== undefined ? { status } : {}),
        ...(admin_notes !== undefined ? { admin_notes } : {}),
      },
    ]) {
      const result = await supabase
        .from('requests')
        .update(row)
        .eq('id', id)
        .select()
        .single();
      if (!result.error && result.data) {
        data = result.data as Record<string, unknown>;
        lastError = null;
        break;
      }
      lastError = {
        message: result.error?.message || 'update failed',
        code: (result.error as { code?: string } | null)?.code,
        details: (result.error as { details?: string } | null)?.details,
        hint: (result.error as { hint?: string } | null)?.hint,
      };
      logger.warn('Admin request update attempt failed', lastError);
    }

    if (!data) {
      throw new AppError(lastError?.message || 'Failed to update request', 500);
    }

    if (status && status !== existing.status) {
      const { data: customer } = await supabase
        .from('users')
        .select('id, telegram_id')
        .eq('id', existing.user_id)
        .maybeSingle();

      if (customer?.telegram_id) {
        try {
          const productName =
            existing.product_name || existing.title || 'your request';
          await notifyCustomMessage(
            customer.telegram_id,
            customer.id,
            `🔔 Your request for "${productName}" is now: ${status}`,
            'Request Update'
          );
        } catch (e) {
          logger.error(`Request status Telegram notify failed: ${e}`);
        }
      } else {
        logger.warn(`No telegram_id for request user ${existing.user_id}`);
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
    const body = (req.body || {}) as { message?: string };
    const message =
      (body.message && String(body.message).trim()) ||
      'You have an update on your product request from KeltaFagebeya admin.';

    const { data: request, error } = await supabase
      .from('requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      logger.error('Notify: request lookup failed', {
        message: error.message,
        code: (error as { code?: string }).code,
        details: (error as { details?: string }).details,
        hint: (error as { hint?: string }).hint,
      });
      res.status(200).json({
        success: false,
        error: error.message,
        message: error.message,
      } satisfies ApiResponse);
      return;
    }
    if (!request) {
      res.status(200).json({
        success: false,
        error: 'Request not found',
        message: 'Request not found',
      } satisfies ApiResponse);
      return;
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, telegram_id, first_name')
      .eq('id', request.user_id)
      .maybeSingle();

    if (userError) {
      logger.error('Notify: user lookup failed', {
        message: userError.message,
        code: (userError as { code?: string }).code,
      });
      res.status(200).json({
        success: false,
        error: userError.message,
        message: userError.message,
      } satisfies ApiResponse);
      return;
    }

    if (!user?.telegram_id) {
      res.status(200).json({
        success: false,
        error: 'Customer Telegram ID not found',
        message: 'Customer Telegram ID not found',
      } satisfies ApiResponse);
      return;
    }

    try {
      await notifyCustomMessage(
        user.telegram_id,
        user.id,
        message,
        'Message from KeltaFagebeya'
      );
      res.status(200).json({
        success: true,
        message: 'Notification sent',
      } satisfies ApiResponse);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error(`Notify Telegram failed: ${errMsg}`);
      res.status(200).json({
        success: false,
        error: errMsg,
        message: errMsg,
      } satisfies ApiResponse);
    }
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

async function loadSellerApplication(id: string) {
  const { data, error } = await supabase
    .from('seller_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error(`seller_applications lookup failed: ${error.message}`, error);
    throw new AppError(error.message || 'Failed to load application', 500);
  }
  if (!data) {
    throw new AppError('Application not found', 404);
  }
  return data;
}

async function updateApplicationStatus(
  id: string,
  payload: Record<string, unknown>
) {
  // Try full payload, then lean (schema may miss reviewed_* / updated_at)
  const attempts = [
    payload,
    {
      status: payload.status,
      admin_notes: payload.admin_notes,
      reviewed_by: payload.reviewed_by,
      reviewed_at: payload.reviewed_at,
    },
    { status: payload.status, admin_notes: payload.admin_notes },
    { status: payload.status },
  ];

  let lastError: string | null = null;
  for (const row of attempts) {
    const clean = Object.fromEntries(
      Object.entries(row).filter(([, v]) => v !== undefined)
    );
    const { data, error } = await supabase
      .from('seller_applications')
      .update(clean)
      .eq('id', id)
      .select()
      .single();

    if (!error && data) return data;
    lastError = error?.message || 'update failed';
    logger.warn(`seller_applications update attempt failed: ${lastError}`);
  }

  throw new AppError(lastError || 'Failed to update application', 500);
}

export async function approveSeller(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);
    const { id } = req.params;

    const application = await loadSellerApplication(id);

    if (application.status === 'approved') {
      throw new AppError('Application already approved', 409);
    }

    const now = new Date().toISOString();

    const updated = await updateApplicationStatus(id, {
      status: 'approved',
      reviewed_by: req.user.id,
      reviewed_at: now,
      updated_at: now,
    });

    const userUpdates: Record<string, unknown>[] = [
      {
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
        // Admin must explicitly enable these later
        receive_orders: false,
        receive_requests: false,
        updated_at: now,
      },
      {
        role: 'seller',
        is_seller: true,
        seller_status: 'approved',
        business_name: application.business_name,
        phone: application.phone,
        receive_orders: false,
        receive_requests: false,
      },
      {
        role: 'seller',
        is_seller: true,
        seller_status: 'approved',
        business_name: application.business_name,
        phone: application.phone,
      },
      {
        role: 'seller',
        seller_status: 'approved',
      },
    ];

    let userUpdateOk = false;
    let userUpdateError: string | null = null;
    for (const row of userUpdates) {
      const { error } = await supabase
        .from('users')
        .update(row)
        .eq('id', application.user_id);
      if (!error) {
        userUpdateOk = true;
        break;
      }
      userUpdateError = error.message;
      logger.warn(`users seller approve update failed: ${error.message}`);
    }

    if (!userUpdateOk) {
      throw new AppError(
        userUpdateError ||
          'Application approved but failed to update user seller role',
        500
      );
    }

    const { data: applicant } = await supabase
      .from('users')
      .select('id, telegram_id')
      .eq('id', application.user_id)
      .maybeSingle();

    if (applicant?.telegram_id) {
      try {
        await notifySellerApplicationDecision(
          applicant.telegram_id,
          applicant.id,
          true
        );
      } catch (e) {
        logger.error(`Approve notify failed: ${e}`);
      }
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
    const { admin_notes } = (req.body || {}) as {
      admin_notes?: string | null;
    };

    const application = await loadSellerApplication(id);

    if (application.status === 'rejected') {
      throw new AppError('Application already rejected', 409);
    }

    const now = new Date().toISOString();

    const updated = await updateApplicationStatus(id, {
      status: 'rejected',
      admin_notes: admin_notes ?? application.admin_notes ?? null,
      reviewed_by: req.user.id,
      reviewed_at: now,
      updated_at: now,
    });

    const userUpdates: Record<string, unknown>[] = [
      {
        seller_status: 'rejected',
        admin_notes: admin_notes ?? null,
        updated_at: now,
      },
      { seller_status: 'rejected' },
    ];

    for (const row of userUpdates) {
      const { error } = await supabase
        .from('users')
        .update(row)
        .eq('id', application.user_id);
      if (!error) break;
      logger.warn(`users seller reject update failed: ${error.message}`);
    }

    const { data: applicant } = await supabase
      .from('users')
      .select('id, telegram_id')
      .eq('id', application.user_id)
      .maybeSingle();

    if (applicant?.telegram_id) {
      try {
        await notifySellerApplicationDecision(
          applicant.telegram_id,
          applicant.id,
          false,
          admin_notes || undefined
        );
      } catch (e) {
        logger.error(`Reject notify failed: ${e}`);
      }
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
        '*, users!orders_user_id_fkey(id, first_name, last_name, username, telegram_id, phone)'
      )
      .order('created_at', { ascending: false })
      .limit(1000);

    if (status) query = query.eq('status', status);
    if (date_from) query = query.gte('created_at', date_from);
    if (date_to) query = query.lte('created_at', date_to);

    let rows: Record<string, unknown>[] = [];
    const { data, error } = await query;

    if (error) {
      logger.warn(`Admin orders join failed: ${error.message}`);
      const fallback = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (fallback.error) throw new AppError(fallback.error.message, 500);
      rows = (fallback.data ?? []) as Record<string, unknown>[];
    } else {
      rows = (data ?? []) as Record<string, unknown>[];
    }

    if (seller_id) {
      rows = rows.filter(
        (o) =>
          Array.isArray(o.items) &&
          (o.items as OrderItem[]).some((item) => item.seller_id === seller_id)
      );
    }

    // Enrich missing customer joins
    const missingUserIds = [
      ...new Set(
        rows
          .filter((o) => !o.users && o.user_id)
          .map((o) => String(o.user_id))
      ),
    ];
    const customerMap = new Map<string, Record<string, unknown>>();
    if (missingUserIds.length) {
      const { data: customers } = await supabase
        .from('users')
        .select('id, first_name, last_name, username, telegram_id, phone')
        .in('id', missingUserIds);
      for (const c of customers ?? []) customerMap.set(c.id, c);
    }

    const normalized = rows.map((o) => {
      const customer =
        (o.users as Record<string, unknown> | null) ||
        customerMap.get(String(o.user_id)) ||
        null;
      return normalizeOrderForClient(o, {
        customer: customer as {
          id?: string;
          first_name?: string | null;
          last_name?: string | null;
          username?: string | null;
          telegram_id?: number | null;
          phone?: string | null;
        } | null,
        seller_breakdown: groupItemsBySeller(
          (Array.isArray(o.items) ? o.items : []) as OrderItem[]
        ),
      });
    });

    const total = normalized.length;
    const from = (pageNum - 1) * limitNum;

    res.status(200).json({
      success: true,
      data: normalized.slice(from, from + limitNum),
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

    // Allow full UUID or short suffix (last 6–8 chars shown in UI as #ec5905)
    let orderRow: Record<string, unknown> | null = null;

    const byId = await supabase
      .from('orders')
      .select(
        '*, users!orders_user_id_fkey(id, first_name, last_name, username, telegram_id, phone)'
      )
      .eq('id', id)
      .maybeSingle();

    if (byId.data) {
      orderRow = byId.data as Record<string, unknown>;
    } else {
      const fallback = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      const match = (fallback.data ?? []).find(
        (o) =>
          o.id === id ||
          String(o.id).replace(/-/g, '').endsWith(id.replace(/^#/, ''))
      );
      if (match) orderRow = match as Record<string, unknown>;
    }

    if (!orderRow) throw new AppError('Order not found', 404);

    let customer =
      (orderRow.users as {
        id?: string;
        first_name?: string | null;
        last_name?: string | null;
        username?: string | null;
        telegram_id?: number | null;
        phone?: string | null;
      } | null) || null;

    if (!customer && orderRow.user_id) {
      const { data } = await supabase
        .from('users')
        .select('id, first_name, last_name, username, telegram_id, phone')
        .eq('id', orderRow.user_id)
        .maybeSingle();
      customer = data;
    }

    const items = (Array.isArray(orderRow.items) ? orderRow.items : []) as OrderItem[];
    const sellerIds = Array.from(
      new Set(items.map((i) => i.seller_id).filter(Boolean))
    );
    const { data: sellers } = await supabase
      .from('users')
      .select('id, first_name, last_name, username, business_name, seller_name')
      .in(
        'id',
        sellerIds.length ? sellerIds : ['00000000-0000-0000-0000-000000000000']
      );

    const data = normalizeOrderForClient(orderRow, {
      customer,
      sellers: sellers ?? [],
      seller_breakdown: groupItemsBySeller(items),
    });

    res.status(200).json({
      success: true,
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function updateAdminOrderStatus(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { status, payment_status } = req.body as {
      status?: string;
      payment_status?: string;
    };

    if (!status && !payment_status) {
      throw new AppError('status or payment_status is required', 400);
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (status) updates.status = status;
    if (payment_status) updates.payment_status = payment_status;

    let { data, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      const lean = { ...updates };
      delete lean.updated_at;
      const retry = await supabase
        .from('orders')
        .update(lean)
        .eq('id', id)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      throw new AppError(error?.message || 'Failed to update order', 500);
    }

    if (status) {
      try {
        const { data: buyer } = await supabase
          .from('users')
          .select('telegram_id, id')
          .eq('id', data.user_id)
          .maybeSingle();
        if (buyer?.telegram_id) {
          await notifyOrderStatusChange(
            buyer.telegram_id,
            buyer.id,
            id,
            status
          );
        }
      } catch (e) {
        logger.error(`Admin order status notify failed: ${e}`);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Order updated',
      data: normalizeOrderForClient(data as Record<string, unknown>),
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}

export async function updateSellerPermissions(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { receive_orders, receive_requests } = req.body as {
      receive_orders?: boolean;
      receive_requests?: boolean;
    };

    // id may be application id or user id
    let userId = id;
    const { data: app } = await supabase
      .from('seller_applications')
      .select('user_id')
      .eq('id', id)
      .maybeSingle();
    if (app?.user_id) userId = app.user_id;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (receive_orders !== undefined) updates.receive_orders = !!receive_orders;
    if (receive_requests !== undefined) {
      updates.receive_requests = !!receive_requests;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select(
        'id, role, seller_status, business_name, receive_orders, receive_requests'
      )
      .single();

    if (error) {
      logger.error('Seller permissions update failed', {
        message: error.message,
        code: (error as { code?: string }).code,
        details: (error as { details?: string }).details,
        hint: (error as { hint?: string }).hint,
      });
      throw new AppError(
        error.message ||
          'Failed to update permissions. Run sql/004_seller_receive_flags.sql in Supabase.',
        500
      );
    }

    res.status(200).json({
      success: true,
      message: 'Seller permissions updated',
      data,
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
    const sid = item.seller_id || '';
    const current = map.get(sid) || {
      seller_id: sid,
      items: [],
      subtotal: 0,
    };
    current.items.push(item);
    current.subtotal += Number(item.price || 0) * Number(item.quantity || 0);
    map.set(sid, current);
  }

  return Array.from(map.values());
}
