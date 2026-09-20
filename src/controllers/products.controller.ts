import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { AppError } from '../utils/AppError';
import { ApiResponse, PRODUCT_CATEGORIES } from '../types';
import { logger } from '../config/logger';

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

    const ascending = sort === 'oldest' || sort === 'price_asc';
    const orderCol =
      sort === 'price_asc' || sort === 'price_desc' ? 'price' : 'created_at';

    // Attempt 1: full query with availability flags + seller join
    let query = supabase
      .from('products')
      .select(
        '*, users!products_seller_id_fkey(id, first_name, last_name, username, seller_name, photo_url)',
        { count: 'exact' }
      )
      .order(orderCol, { ascending })
      .range(from, to);

    // Soft filters — may fail if columns missing
    query = query.eq('is_available', true).neq('is_active', false);

    if (category) query = query.eq('category', category);
    if (sub_category) query = query.eq('sub_category', sub_category);
    if (seller_id) query = query.eq('seller_id', seller_id);
    if (min_price !== undefined) query = query.gte('price', Number(min_price));
    if (max_price !== undefined) query = query.lte('price', Number(max_price));
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    let { data, error, count } = await query;

    if (error) {
      logger.warn(`Products query fallback (no flags/join): ${error.message}`);

      let fallback = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (category) fallback = fallback.eq('category', category);
      if (sub_category) fallback = fallback.eq('sub_category', sub_category);
      if (seller_id) fallback = fallback.eq('seller_id', seller_id);
      if (search) {
        fallback = fallback.or(
          `name.ilike.%${search}%,description.ilike.%${search}%`
        );
      }

      const result = await fallback;
      if (result.error) {
        // Last resort: plain select
        const plain = await supabase
          .from('products')
          .select('*', { count: 'exact' })
          .range(from, to);

        if (plain.error) throw new AppError(plain.error.message, 500);
        data = plain.data;
        count = plain.count;
      } else {
        data = result.data;
        count = result.count;
      }
    }

    const total = count ?? 0;
    res.status(200).json({
      success: true,
      data: data ?? [],
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 0,
      },
    } satisfies ApiResponse);
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
      .select(
        '*, users!products_seller_id_fkey(id, first_name, last_name, username, seller_name, seller_bio, photo_url)'
      )
      .eq('id', id)
      .single();

    if (error || !data) {
      const fallback = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();
      if (fallback.error || !fallback.data) {
        throw new AppError('Product not found', 404);
      }

      let seller = null;
      if (fallback.data.seller_id) {
        const { data: sellerData } = await supabase
          .from('users')
          .select(
            'id, first_name, last_name, username, seller_name, seller_bio, photo_url'
          )
          .eq('id', fallback.data.seller_id)
          .single();
        seller = sellerData;
      }

      res.status(200).json({
        success: true,
        data: { ...fallback.data, seller },
      } satisfies ApiResponse);
      return;
    }

    res.status(200).json({ success: true, data } satisfies ApiResponse);
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

    const body = req.body as Record<string, unknown>;
    const images = Array.isArray(body.images)
      ? (body.images as string[])
      : typeof body.images === 'string' && body.images
        ? [body.images]
        : [];

    const insertRow: Record<string, unknown> = {
      name: body.name || body.title,
      description: body.description ?? '',
      price: Number(body.price),
      category: body.category,
      sub_category: body.sub_category || body.subCategory || null,
      stock: Number(body.stock ?? body.quantity ?? 0),
      images,
      seller_id: req.user.id,
    };

    // Optional columns — only if present in schema after migration
    insertRow.is_available = true;
    insertRow.is_active = true;

    let { data, error } = await supabase
      .from('products')
      .insert(insertRow)
      .select()
      .single();

    if (error?.message?.includes('is_available') || error?.message?.includes('is_active') || error?.message?.includes('currency')) {
      logger.warn(`Product create retry lean row: ${error.message}`);
      const lean = {
        name: insertRow.name,
        description: insertRow.description,
        price: insertRow.price,
        category: insertRow.category,
        sub_category: insertRow.sub_category,
        stock: insertRow.stock,
        images,
        seller_id: req.user.id,
      };
      const retry = await supabase.from('products').insert(lean).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      throw new AppError(error?.message || 'Failed to create product', 500);
    }

    res.status(201).json({
      success: true,
      message: 'Product created',
      data,
    } satisfies ApiResponse);
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

    if (existing.seller_id !== req.user.id) {
      throw new AppError('Not authorized to update this product', 403);
    }

    const body = { ...(req.body as Record<string, unknown>) };
    delete body.currency;
    delete body.seller_id;
    delete body.id;

    const { data, error } = await supabase
      .from('products')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      // Retry without updated_at
      const retry = await supabase
        .from('products')
        .update(body)
        .eq('id', id)
        .select()
        .single();
      if (retry.error || !retry.data) {
        throw new AppError(error?.message || 'Failed to update product', 500);
      }
      res.status(200).json({
        success: true,
        message: 'Product updated',
        data: retry.data,
      } satisfies ApiResponse);
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Product updated',
      data,
    } satisfies ApiResponse);
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

    if (existing.seller_id !== req.user.id) {
      throw new AppError('Not authorized to delete this product', 403);
    }

    // Prefer soft delete
    const soft = await supabase
      .from('products')
      .update({ is_active: false, is_available: false })
      .eq('id', id);

    if (soft.error) {
      const hard = await supabase.from('products').delete().eq('id', id);
      if (hard.error) throw new AppError(hard.error.message, 500);
    }

    res.status(200).json({
      success: true,
      message: 'Product deleted',
    } satisfies ApiResponse);
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

    res.status(200).json({
      success: true,
      data: categories,
    } satisfies ApiResponse);
  } catch (err) {
    next(err);
  }
}
