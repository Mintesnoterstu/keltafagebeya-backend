import { z } from 'zod';

/** Normalize payment labels from checkout UI → DB values (cod / cash / stripe / chapa) */
const paymentMethodSchema = z
  .string()
  .transform((v) =>
    v
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[()%]/g, '')
  )
  .transform((v) => {
    if (v.startsWith('cash_on_delivery') || v === 'cod' || v === 'cashondelivery') {
      return 'cash_on_delivery';
    }
    if (v === 'card_stripe' || v === 'card' || v === 'stripe') return 'stripe';
    if (v === 'telebirr' || v === 'cbe_birr' || v === 'bank_transfer') return 'chapa';
    if (v === 'chapa') return 'chapa';
    if (v === 'cash') return 'cash';
    return v;
  })
  .pipe(
    z.enum([
      'stripe',
      'chapa',
      'cash',
      'cash_on_delivery',
      'cod',
      'cashondelivery',
      'card_stripe',
      'telebirr',
      'cbe_birr',
      'bank_transfer',
    ])
  )
  .transform((v) => {
    if (v === 'cash_on_delivery' || v === 'cod' || v === 'cashondelivery') {
      return 'cod' as const;
    }
    if (v === 'card_stripe') return 'stripe' as const;
    if (v === 'telebirr' || v === 'cbe_birr' || v === 'bank_transfer') {
      return 'chapa' as const;
    }
    return v as 'stripe' | 'chapa' | 'cash' | 'cod';
  });

const addressObjectSchema = z
  .object({
    full_name: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    subcity: z.string().optional().nullable(),
    sub_city: z.string().optional().nullable(),
    woreda: z.string().optional().nullable(),
    street_address: z.string().optional().nullable(),
    landmark: z.string().optional().nullable(),
    detail: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    street: z.string().optional().nullable(),
    line1: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .passthrough()
  .transform((a) => {
    const line =
      a.address ||
      a.street_address ||
      a.street ||
      a.line1 ||
      a.detail ||
      [a.city, a.subcity || a.sub_city, a.woreda].filter(Boolean).join(', ') ||
      '';

    return {
      full_name: a.full_name || a.name || 'Customer',
      name: a.name || a.full_name || 'Customer',
      phone: a.phone || '',
      city: a.city || 'Addis Ababa',
      subcity: a.subcity || a.sub_city || null,
      sub_city: a.sub_city || a.subcity || null,
      woreda: a.woreda ?? null,
      street_address: a.street_address ?? null,
      detail: a.detail ?? a.street_address ?? null,
      landmark: a.landmark ?? null,
      address: line,
      notes: a.notes ?? a.landmark ?? null,
      ...a,
    };
  });

const orderItemSchema = z
  .object({
    product_id: z.string().min(1),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().nonnegative().optional(),
    product_name: z.string().optional(),
    name: z.string().optional(),
    product_image: z.string().optional(),
    image: z.string().optional(),
    sub_total: z.coerce.number().optional(),
  })
  .passthrough();

/**
 * Accepts checkout payloads from the Mini App (local cart → items in body).
 */
export const createOrderSchema = z
  .object({
    payment_method: paymentMethodSchema,
    shipping_address: addressObjectSchema.optional().nullable(),
    address: addressObjectSchema.optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    total: z.coerce.number().optional(),
    total_amount: z.coerce.number().optional(),
    subtotal: z.coerce.number().optional(),
    delivery_fee: z.coerce.number().optional(),
    items: z.array(orderItemSchema).optional(),
    user_id: z.string().optional(),
    telegram_id: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((body, ctx) => {
    if (!body.shipping_address && !body.address) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'shipping_address or address is required',
        path: ['shipping_address'],
      });
    }
  })
  .transform((body) => {
    const shipping = body.shipping_address || body.address || null;
    return {
      payment_method: body.payment_method,
      shipping_address: shipping,
      notes: body.notes ?? null,
      delivery_fee: body.delivery_fee,
      total: body.total ?? body.total_amount,
      items: body.items ?? [],
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
