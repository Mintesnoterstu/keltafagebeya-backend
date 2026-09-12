import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse, PRODUCT_CATEGORIES } from '../types';

export async function getProducts(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      category,
      sub_category,
      search,
      min_price,
      max_price,
      seller_id,
      page = 1,
      limit = 20,
      sort = 'newest',
    } = req.query as Record<string, string | number>;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase
      .from('products')
      .select('*, users!products_seller_id_fkey(id, first_name, last_name, username, seller_name, photo_url)', {
        count: 'exact',
      })
      .eq('is_available', true)
      .neq('is_active', false);

    if (category) query = query.eq('category', category);
    if (sub_category) query = query.eq('sub_category', sub_category);
    if (seller_id) query = query.eq('seller_id', seller_id);
    if (min_price !== undefined) query = query.gte('price', Number(min_price));
    if (max_price !== undefined) query = query.lte('price', Number(max_price));
    if (search) query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);

    switch (sort) {
      case 'price_asc':
        query = query.order('price', { ascending: true });
        break;
      case 'price_desc':
        query = query.order('price', { ascending: false });
        break;
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      default:
        query = query.order('created_at', { ascending: false });
    }

    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      // Fallback without seller join if FK name differs
      const fallback = await supabase
        .from('products')
        .select('*', { count: 'exact' })
        .eq('is_available', true)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (fallback.error) {
        throw new AppError(fallback.error.message, 500);
      }

      const total = fallback.count ?? 0;
      const body: ApiResponse = {
        success: true,
        data: fallback.data,
        meta: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
      res.status(200).json(body);
      return;
    }

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

export async function getProductById(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('products')
      .select('*, users!products_seller_id_fkey(id, first_name, last_name, username, seller_name, seller_bio, photo_url)')
      .eq('id', id)
      .single();

    if (error || !data) {
      const fallback = await supabase.from('products').select('*').eq('id', id).single();
      if (fallback.error || !fallback.data) {
        throw new AppError('Product not found', 404);
      }

      let seller = null;
      if (fallback.data.seller_id) {
        const { data: sellerData } = await supabase
          .from('users')
          .select('id, first_name, last_name, username, seller_name, seller_bio, photo_url')
          .eq('id', fallback.data.seller_id)
          .single();
        seller = sellerData;
      }

      const body: ApiResponse = {
        success: true,
        data: { ...fallback.data, seller },
      };
      res.status(200).json(body);
      return;
    }

    const body: ApiResponse = { success: true, data };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function createProduct(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { data, error } = await supabase
      .from('products')
      .insert({
        ...req.body,
        seller_id: req.user.id,
      })
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || 'Failed to create product', 500);
    }

    const body: ApiResponse = {
      success: true,
      message: 'Product created',
      data,
    };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
}

export async function updateProduct(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;

    const { data: existing } = await supabase
      .from('products')
      .select('seller_id')
      .eq('id', id)
      .single();

    if (!existing) throw new AppError('Product not found', 404);

    if (existing.seller_id !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to update this product', 403);
    }

    const { data, error } = await supabase
      .from('products')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new AppError(error?.message || 'Failed to update product', 500);
    }

    const body: ApiResponse = {
      success: true,
      message: 'Product updated',
      data,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function deleteProduct(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) throw new AppError('Not authenticated', 401);

    const { id } = req.params;

    const { data: existing } = await supabase
      .from('products')
      .select('seller_id')
      .eq('id', id)
      .single();

    if (!existing) throw new AppError('Product not found', 404);

    if (existing.seller_id !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('Not authorized to delete this product', 403);
    }

    const { error } = await supabase.from('products').delete().eq('id', id);

    if (error) {
      throw new AppError(error.message, 500);
    }

    const body: ApiResponse = {
      success: true,
      message: 'Product deleted',
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}

export async function getCategories(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const categories = Object.entries(PRODUCT_CATEGORIES).map(
      ([name, subCategories]) => ({
        name,
        sub_categories: subCategories,
      })
    );

    const body: ApiResponse = {
      success: true,
      data: categories,
    };
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
}
