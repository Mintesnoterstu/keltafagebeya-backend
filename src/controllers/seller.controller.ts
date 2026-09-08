import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse, OrderItem } from '../types';

export async function getSellerStats(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const sellerId = req.user.id;

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, stock, is_available, price')
      .eq('seller_id', sellerId);

    if (productsError) throw new AppError(productsError.message, 500);

    const productList = products ?? [];
    const productIds = new Set(productList.map((p) => p.id));

    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (ordersError) throw new AppError(ordersError.message, 500);

    const sellerOrders = (orders ?? []).filter(
      (order) =>
        Array.isArray(order.items) &&
        order.items.some((item: OrderItem) => item.seller_id === sellerId)
    );

    let revenue = 0;
    let pendingOrders = 0;
    let completedOrders = 0;

    for (const order of sellerOrders) {
      const sellerItems = (order.items as OrderItem[]).filter(
        (item) => item.seller_id === sellerId
      );
      const orderRevenue = sellerItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      if (order.payment_status === 'completed' || order.status === 'delivered') {
        revenue += orderRevenue;
        completedOrders += 1;
      }

      if (['pending', 'paid', 'processing', 'shipped'].includes(order.status)) {
        pendingOrders += 1;
      }
    }

    const body: ApiResponse = {
      success: true,
      data: {
        total_products: productList.length,
        available_products: productList.filter((p) => p.is_available).length,
        low_stock_products: productList.filter((p) => p.stock > 0 && p.stock <= 5)
          .length,
        total_orders: sellerOrders.length,
        pending_orders: pendingOrders,
        completed_orders: completedOrders,
        revenue,
        currency: 'ETB',
        product_ids: Array.from(productIds),
      },
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function getSellerProducts(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { page = 1, limit = 20 } = req.query as Record<string, string | number>;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const { data, error, count } = await supabase
      .from('products')
      .select('*', { count: 'exact' })
      .eq('seller_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw new AppError(error.message, 500);

    const total = count ?? 0;
    const body: ApiResponse = {
      success: true,
      data,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function updateSellerProfile(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const updates: Record<string, unknown> = {
      ...req.body,
      updated_at: new Date().toISOString(),
    };

    if (req.body.is_seller === true) {
      updates.role = req.user.role === 'admin' ? 'admin' : 'seller';
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || 'Failed to update profile', 500);
    }

    const body: ApiResponse = {
      success: true,
      message: 'Seller profile updated',
      data,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
