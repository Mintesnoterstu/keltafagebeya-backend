import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  price: z.number().positive(),
  currency: z.string().default('ETB'),
  category: z.string().min(1),
  sub_category: z.string().optional().nullable(),
  images: z.array(z.string().url()).default([]),
  stock: z.number().int().min(0).default(0),
  is_available: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial();

export const productQuerySchema = z.object({
  category: z.string().optional(),
  sub_category: z.string().optional(),
  search: z.string().optional(),
  min_price: z.coerce.number().optional(),
  max_price: z.coerce.number().optional(),
  seller_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['price_asc', 'price_desc', 'newest', 'oldest']).default('newest'),
});

export const productIdSchema = z.object({
  id: z.string().uuid(),
});
