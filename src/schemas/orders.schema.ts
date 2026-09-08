import { z } from 'zod';

export const createOrderSchema = z.object({
  payment_method: z.enum(['stripe', 'chapa', 'cash']),
  shipping_address: z
    .object({
      full_name: z.string().min(1),
      phone: z.string().min(1),
      city: z.string().min(1),
      address: z.string().min(1),
      notes: z.string().optional(),
    })
    .optional()
    .nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'pending',
    'paid',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'refunded',
  ]),
});

export const orderIdSchema = z.object({
  id: z.string().uuid(),
});

export const orderQuerySchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
