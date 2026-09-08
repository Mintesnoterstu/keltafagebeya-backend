import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse } from '../types';

export async function getCart(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { data, error } = await supabase
      .from('cart_items')
      .select('*, products(*)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new AppError(error.message, 500);
    }

    const items = data ?? [];
    const total = items.reduce((sum, item) => {
      const price = item.products?.price ?? 0;
      return sum + price * item.quantity;
    }, 0);

    const body: ApiResponse = {
      success: true,
      data: {
        items,
        item_count: items.length,
        total,
      },
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function addToCart(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { product_id, quantity } = req.body;

    const { data: product } = await supabase
      .from('products')
      .select('id, stock, is_available')
      .eq('id', product_id)
      .single();

    if (!product || !product.is_available) {
      throw new AppError('Product not available', 404);
    }

    if (product.stock < quantity) {
      throw new AppError('Insufficient stock', 400);
    }

    const { data: existing } = await supabase
      .from('cart_items')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('product_id', product_id)
      .maybeSingle();

    let cartItem;

    if (existing) {
      const newQty = existing.quantity + quantity;
      if (product.stock < newQty) {
        throw new AppError('Insufficient stock', 400);
      }

      const { data, error } = await supabase
        .from('cart_items')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*, products(*)')
        .single();

      if (error || !data) throw new AppError('Failed to update cart', 500);
      cartItem = data;
    } else {
      const { data, error } = await supabase
        .from('cart_items')
        .insert({
          user_id: req.user.id,
          product_id,
          quantity,
        })
        .select('*, products(*)')
        .single();

      if (error || !data) throw new AppError('Failed to add to cart', 500);
      cartItem = data;
    }

    const body: ApiResponse = {
      success: true,
      message: 'Item added to cart',
      data: cartItem,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function updateCartItem(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;
    const { quantity } = req.body;

    const { data: existing } = await supabase
      .from('cart_items')
      .select('*, products(stock)')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) throw new AppError('Cart item not found', 404);

    const stock = (existing.products as { stock: number } | null)?.stock ?? 0;
    if (quantity > stock) {
      throw new AppError('Insufficient stock', 400);
    }

    const { data, error } = await supabase
      .from('cart_items')
      .update({ quantity, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, products(*)')
      .single();

    if (error || !data) throw new AppError('Failed to update cart item', 500);

    const body: ApiResponse = {
      success: true,
      message: 'Cart item updated',
      data,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function removeCartItem(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;

    const { data: existing } = await supabase
      .from('cart_items')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!existing) throw new AppError('Cart item not found', 404);

    const { error } = await supabase.from('cart_items').delete().eq('id', id);

    if (error) throw new AppError(error.message, 500);

    const body: ApiResponse = {
      success: true,
      message: 'Item removed from cart',
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function clearCart(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', req.user.id);

    if (error) throw new AppError(error.message, 500);

    const body: ApiResponse = {
      success: true,
      message: 'Cart cleared',
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
