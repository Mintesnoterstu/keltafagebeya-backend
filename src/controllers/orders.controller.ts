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

type BodyItem = {
  product_id: string;
  quantity: number;
  price?: number;
  product_name?: string;
  name?: string;
  product_image?: string;
  image?: string;
};

async function buildItemsFromCart(userId: string): Promise<{
  orderItems: OrderItem[];
  totalAmount: number;
  currency: string;
  cartRows: Array<{ product_id: string; quantity: number; products: Record<string, unknown> }>;
}> {
  const { data: cartItems, error: cartError } = await supabase
    .from('cart_items')
    .select('*, products(*)')
    .eq('user_id', userId);

  if (cartError) throw new AppError(cartError.message, 500);
  if (!cartItems || cartItems.length === 0) {
    return { orderItems: [], totalAmount: 0, currency: 'ETB', cartRows: [] };
  }

  const orderItems: OrderItem[] = [];
  let totalAmount = 0;
  let currency = 'ETB';

  for (const item of cartItems) {
    const product = item.products as Record<string, unknown> | null;
    if (!product) {
      throw new AppError(`Product unavailable: ${item.product_id}`, 400);
    }
    if (product.is_available === false) {
      throw new AppError(`Product unavailable: ${String(product.name || item.product_id)}`, 400);
    }
    const stock = Number(product.stock ?? 0);
    if (stock < item.quantity) {
      throw new AppError(`Insufficient stock for ${String(product.name)}`, 400);
    }

    const price = Number(product.price);
    orderItems.push({
      product_id: String(product.id),
      name: String(product.name),
      price,
      quantity: item.quantity,
      image: Array.isArray(product.images) ? (product.images[0] as string) : undefined,
      seller_id: (product.seller_id as string) || '',
    });
    totalAmount += price * item.quantity;
    currency = (product.currency as string) || 'ETB';
  }

  return {
    orderItems,
    totalAmount,
    currency,
    cartRows: cartItems as Array<{
      product_id: string;
      quantity: number;
      products: Record<string, unknown>;
    }>,
  };
}

async function buildItemsFromBody(items: BodyItem[]): Promise<{
  orderItems: OrderItem[];
  totalAmount: number;
  currency: string;
}> {
  const orderItems: OrderItem[] = [];
  let totalAmount = 0;
  const currency = 'ETB';

  for (const item of items) {
    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', item.product_id)
      .maybeSingle();

    if (error) {
      logger.error('Product lookup for order failed', {
        message: error.message,
        code: (error as { code?: string }).code,
        product_id: item.product_id,
      });
      throw new AppError(error.message, 500);
    }

    const qty = Number(item.quantity);
    if (!product) {
      // Allow checkout even if product row missing (use payload snapshot)
      const price = Number(item.price ?? 0);
      orderItems.push({
        product_id: item.product_id,
        name: item.product_name || item.name || 'Product',
        price,
        quantity: qty,
        image: item.product_image || item.image,
        seller_id: '',
      });
      totalAmount += price * qty;
      continue;
    }

    if (product.is_available === false) {
      throw new AppError(`Product unavailable: ${product.name}`, 400);
    }
    if (Number(product.stock ?? 0) < qty) {
      throw new AppError(`Insufficient stock for ${product.name}`, 400);
    }

    const price = Number(item.price ?? product.price);
    orderItems.push({
      product_id: product.id,
      name: product.name,
      price,
      quantity: qty,
      image: product.images?.[0] || item.product_image || item.image,
      seller_id: product.seller_id || '',
    });
    totalAmount += price * qty;
  }

  return { orderItems, totalAmount, currency };
}

export async function createOrder(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const {
      payment_method,
      shipping_address,
      notes,
      delivery_fee,
      items: bodyItems,
      total: bodyTotal,
    } = req.body as {
      payment_method: string;
      shipping_address: Record<string, unknown> | null;
      notes: string | null;
      delivery_fee?: number;
      items?: BodyItem[];
      total?: number;
    };

    // Prefer DB cart; if empty, use items from Mini App local cart payload
    let orderItems: OrderItem[] = [];
    let totalAmount = 0;
    let currency = 'ETB';
    let cartRows: Array<{
      product_id: string;
      quantity: number;
      products: Record<string, unknown>;
    }> = [];

    const fromCart = await buildItemsFromCart(req.user.id);
    if (fromCart.orderItems.length > 0) {
      orderItems = fromCart.orderItems;
      totalAmount = fromCart.totalAmount;
      currency = fromCart.currency;
      cartRows = fromCart.cartRows;
    } else if (Array.isArray(bodyItems) && bodyItems.length > 0) {
      const fromBody = await buildItemsFromBody(bodyItems);
      orderItems = fromBody.orderItems;
      totalAmount = fromBody.totalAmount;
      currency = fromBody.currency;
    } else {
      throw new AppError('Cart is empty', 400);
    }

    const deliveryFee = Number(delivery_fee || 0);
    const grandTotal =
      bodyTotal != null && Number(bodyTotal) > 0
        ? Number(bodyTotal)
        : totalAmount + deliveryFee;

    const addressPayload = shipping_address ?? null;

    const insertAttempts: Record<string, unknown>[] = [
      {
        user_id: req.user.id,
        items: orderItems,
        total_amount: grandTotal,
        total: grandTotal,
        currency,
        status: 'pending',
        payment_method,
        payment_status: 'pending',
        shipping_address: addressPayload,
        address: addressPayload,
        notes: notes ?? null,
      },
      {
        user_id: req.user.id,
        items: orderItems,
        total_amount: grandTotal,
        status: 'pending',
        payment_method,
        payment_status: 'pending',
        shipping_address: addressPayload,
        notes: notes ?? null,
      },
      {
        user_id: req.user.id,
        items: orderItems,
        total: grandTotal,
        status: 'pending',
        payment_method,
        payment_status: 'pending',
        address: addressPayload,
      },
      {
        user_id: req.user.id,
        items: orderItems,
        total: grandTotal,
        status: 'pending',
        payment_method,
        address: addressPayload,
      },
    ];

    let order: Record<string, unknown> | null = null;
    let lastError: string | null = null;

    for (const row of insertAttempts) {
      const result = await supabase.from('orders').insert(row).select().single();
      if (!result.error && result.data) {
        order = result.data as Record<string, unknown>;
        lastError = null;
        break;
      }
      lastError = result.error?.message || 'insert failed';
      logger.warn(`Order insert attempt failed: ${lastError}`, {
        code: (result.error as { code?: string } | null)?.code,
        details: (result.error as { details?: string } | null)?.details,
        hint: (result.error as { hint?: string } | null)?.hint,
      });
    }

    // If DB rejects `cod`, retry mapped payment as `cash`
    if (!order && payment_method === 'cod') {
      for (const row of insertAttempts) {
        const retryRow = { ...row, payment_method: 'cash' };
        const result = await supabase.from('orders').insert(retryRow).select().single();
        if (!result.error && result.data) {
          order = result.data as Record<string, unknown>;
          lastError = null;
          break;
        }
        lastError = result.error?.message || lastError;
      }
    }

    if (!order) {
      throw new AppError(lastError || 'Failed to create order', 500);
    }

    // Decrement stock for ordered products
    for (const item of orderItems) {
      const { data: product } = await supabase
        .from('products')
        .select('stock')
        .eq('id', item.product_id)
        .maybeSingle();
      if (product && product.stock != null) {
        await supabase
          .from('products')
          .update({ stock: Math.max(0, Number(product.stock) - item.quantity) })
          .eq('id', item.product_id);
      }
    }

    // Clear server cart if any
    if (cartRows.length > 0) {
      await supabase.from('cart_items').delete().eq('user_id', req.user.id);
    }

    const buyerName =
      `${req.user.first_name} ${req.user.last_name || ''}`.trim() ||
      String(addressPayload?.full_name || addressPayload?.name || 'Customer');

    try {
      await notifyNewOrder({
        orderId: String(order.id),
        total: grandTotal,
        currency,
        customerName: buyerName,
        username: req.user.username,
        paymentMethod: payment_method,
        itemCount: orderItems.length,
      });
    } catch (e) {
      logger.error(`Order created but admin Telegram notify failed: ${e}`);
    }

    try {
      const sellerCounts = new Map<string, number>();
      for (const item of orderItems) {
        if (!item.seller_id) continue;
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
          await notifySellerNewOrder(seller.telegram_id, String(order.id), count);
        }
      }
    } catch (e) {
      logger.error(`Seller order notify failed: ${e}`);
    }

    res.status(201).json({
      success: true,
      message: 'Order created',
      data: order,
    } satisfies ApiResponse);
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

    const {
      status,
      page = 1,
      limit = 20,
    } = req.query as Record<string, string | number>;
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

    res.status(200).json({
      success: true,
      data: data ?? [],
      meta: {
        page: pageNum,
        limit: limitNum,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limitNum),
      },
    } satisfies ApiResponse);
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

    if (data.user_id !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized', 403);
    }

    res.status(200).json({ success: true, data } satisfies ApiResponse);
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
    const sellerId = req.user.id;

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw new AppError(error.message, 500);

    const filtered = (data ?? []).filter(
      (order) =>
        Array.isArray(order.items) &&
        order.items.some((item: OrderItem) => item.seller_id === sellerId)
    );

    res.status(200).json({
      success: true,
      data: filtered,
    } satisfies ApiResponse);
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

    const { data: existing, error: findError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !existing) throw new AppError('Order not found', 404);

    const isAdmin = req.user.role === 'admin';
    const isSeller =
      Array.isArray(existing.items) &&
      existing.items.some((item: OrderItem) => item.seller_id === req.user!.id);

    if (!isAdmin && !isSeller) {
      throw new AppError('Not authorized', 403);
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || 'Failed to update order', 500);
    }

    try {
      const { data: buyer } = await supabase
        .from('users')
        .select('telegram_id, id')
        .eq('id', existing.user_id)
        .maybeSingle();
      if (buyer?.telegram_id) {
        await notifyOrderStatusChange(buyer.telegram_id, buyer.id, id, status);
      }
    } catch (e) {
      logger.error(`Order status notify failed: ${e}`);
    }

    res.status(200).json({
      success: true,
      message: 'Order status updated',
      data,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}
