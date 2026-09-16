import { z } from 'zod';

const paymentMethodSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase().replace(/[\s-]+/g, '_'))
  .pipe(
    z.enum([
      'stripe',
      'chapa',
      'cash',
      'cash_on_delivery',
      'cod',
      'cashondelivery',
    ])
  )
  .transform((v) => {
    if (v === 'cash_on_delivery' || v === 'cod' || v === 'cashondelivery') {
      return 'cash' as const;
    }
    return v as 'stripe' | 'chapa' | 'cash';
  });

const addressObjectSchema = z
  .object({
    full_name: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    subcity: z.string().optional().nullable(),
    sub_city: z.string().optional().nullable(),
    address: z.string().min(1).optional(),
    street: z.string().min(1).optional(),
    line1: z.string().min(1).optional(),
    notes: z.string().optional().nullable(),
  })
  .passthrough()
  .transform((a) => ({
    full_name: a.full_name || a.name || 'Customer',
    phone: a.phone || '',
    city: a.city || 'Addis Ababa',
    subcity: a.subcity || a.sub_city || null,
    address: a.address || a.street || a.line1 || '',
    notes: a.notes ?? null,
    ...a,
  }));

/**
 * Accepts multiple frontend shapes:
 * - { payment_method, shipping_address, notes }
 * - { payment_method, address, notes }
 * - payment_method: "cash" | "cash_on_delivery" | "Cash On Delivery" | "cod"
 */
export const createOrderSchema = z
  .object({
    payment_method: paymentMethodSchema,
    shipping_address: addressObjectSchema.optional().nullable(),
    address: addressObjectSchema.optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    // Some frontends also send these; ignore safely
    total: z.coerce.number().optional(),
    delivery_fee: z.coerce.number().optional(),
    items: z.any().optional(),
  })
  .transform((body) => {
    const shipping = body.shipping_address || body.address || null;
    return {
      payment_method: body.payment_method,
      shipping_address: shipping,
      notes: body.notes ?? null,
      delivery_fee: body.delivery_fee,
    };
  });

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'pending',
    'paid',
    'confirmed',
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
