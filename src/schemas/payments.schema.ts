import { z } from 'zod';

export const stripeCreateIntentSchema = z.object({
  order_id: z.string().uuid(),
});

export const chapaInitializeSchema = z.object({
  order_id: z.string().uuid(),
  email: z.string().email().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
});

export const chapaVerifySchema = z.object({
  id: z.string().min(1),
});

export const updateSellerProfileSchema = z.object({
  seller_name: z.string().min(1).max(100).optional(),
  seller_bio: z.string().max(1000).optional().nullable(),
  phone: z.string().optional().nullable(),
  is_seller: z.boolean().optional(),
});
