import { z } from 'zod';

export const addCartItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1),
});

export const cartItemIdSchema = z.object({
  id: z.string().uuid(),
});
