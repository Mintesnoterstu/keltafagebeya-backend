import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse, OrderItem } from '../types';
import {
  notifyNewOrder,
  notifyOrderStatusChange,
  notifySellerNewOrder,
} from '../services/telegram.service';
import { logger } from '../config/logger';

export async function createOrder(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { payment_method, shipping_address, notes } = req.body;

    const { data: cartItems, error: cartError } = await supabase
      .from('cart_items')
      .select('*, products(*)')
      .eq('user_id', req.user.id);

    if (cartError) throw new AppError(cartError.message, 500);
    if (!cartItems || cartItems.length === 0) {
      throw new AppError('Cart is empty', 400);
    }

    const orderItems: OrderItem[] = [];
    let totalAmount = 0;
    let currency = 'ETB';

    for (const item of cartItems) {
      const product = item.products;
      if (!product || !product.is_available) {
        throw new AppError(`Product unavailable: ${item.product_id}`, 400);
      }
      if (product.stock < item.quantity) {
        throw new AppError(`Insufficient stock for ${product.name}`, 400);
      }

      orderItems.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        image: product.images?.[0],
        seller_id: product.seller_id,
      });

      totalAmount += product.price * item.quantity;
      currency = product.currency || 'ETB';
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: req.user.id,
        items: orderItems,
        total_amount: totalAmount,
        currency,
        status: 'pending',
        payment_method,
        payment_status: 'pending',
        shipping_address: shipping_address ?? null,
        notes: notes ?? null,
      })
      .select()
      .single();

    if (orderError || !order) {
      throw new AppError(orderError?.message || 'Failed to create order', 500);
    }

    // Decrement stock
    for (const item of cartItems) {
      const product = item.products;
      await supabase
        .from('products')
        .update({ stock: product.stock - item.quantity })
        .eq('id', product.id);
    }

    // Clear cart
    await supabase.from('cart_items').delete().eq('user_id', req.user.id);

    const buyerName =
      `${req.user.first_name} ${req.user.last_name || ''}`.trim();

    try {
      await notifyNewOrder({
        orderId: order.id,
        total: totalAmount,
        currency,
        customerName: buyerName,
        username: req.user.username,
        paymentMethod: payment_method,
        itemCount: orderItems.length,
      });
    } catch (e) {
      logger.error(`Order created but admin Telegram notify failed: ${e}`);
    }

    // Notify each unique seller
    try {
      const sellerCounts = new Map<string, number>();
      for (const item of orderItems) {
        sellerCounts.set(
          item.seller_id,
          (sellerCounts.get(item.seller_id) || 0) + item.quantity
        );
      }

      for (const [sellerId, count] of sellerCounts) {
        const { data: seller } = await supabase
          .from('users')
          .select('telegram_id')
          .eq('id', sellerId)
          .maybeSingle();
        if (seller?.telegram_id) {
          await notifySellerNewOrder(seller.telegram_id, order.id, count);
        }
      }
    } catch (e) {
      logger.error(`Seller order notify failed: ${e}`);
    }

    const body: ApiResponse = {
      success: true,
      message: 'Order created',
      data: order,
    };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
}

export async function getOrders(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { status, page = 1, limit = 20 } = req.query as Record<
      string,
      string | number
    >;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;

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

export async function getOrderById(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) throw new AppError('Order not found', 404);

    const isOwner = data.user_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    const isSeller =
      req.user.is_seller &&
      Array.isArray(data.items) &&
      data.items.some(
        (item: OrderItem) => item.seller_id === req.user!.id
      );

    if (!isOwner && !isAdmin && !isSeller) {
      throw new AppError('Not authorized to view this order', 403);
    }

    const body: ApiResponse = { success: true, data };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function updateOrderStatus(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;
    const { status } = req.body;

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*, users(telegram_id, id)')
      .eq('id', id)
      .single();

    if (fetchError || !order) throw new AppError('Order not found', 404);

    const isAdmin = req.user.role === 'admin';
    const isSeller =
      req.user.is_seller &&
      Array.isArray(order.items) &&
      order.items.some(
        (item: OrderItem) => item.seller_id === req.user!.id
      );

    if (!isAdmin && !isSeller) {
      throw new AppError('Not authorized to update this order', 403);
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || 'Failed to update order', 500);
    }

    const user = order.users as { telegram_id: number; id: string } | null;
    if (user) {
      await notifyOrderStatusChange(user.telegram_id, user.id, id, status);
    }

    const body: ApiResponse = {
      success: true,
      message: 'Order status updated',
      data,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function getSellerOrders(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { status, page = 1, limit = 20 } = req.query as Record<
      string,
      string | number
    >;
    const pageNum = Number(page);
    const limitNum = Number(limit);

    // Fetch recent orders and filter by seller_id in items JSONB
    let query = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) throw new AppError(error.message, 500);

    const sellerId = req.user.id;
    const filtered = (data ?? []).filter(
      (order) =>
        Array.isArray(order.items) &&
        order.items.some((item: OrderItem) => item.seller_id === sellerId)
    );

    const total = filtered.length;
    const from = (pageNum - 1) * limitNum;
    const paged = filtered.slice(from, from + limitNum);

    // Only include items belonging to this seller
    const mapped = paged.map((order) => ({
      ...order,
      items: order.items.filter(
        (item: OrderItem) => item.seller_id === sellerId
      ),
    }));

    const body: ApiResponse = {
      success: true,
      data: mapped,
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
