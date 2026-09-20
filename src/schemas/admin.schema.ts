import { z } from 'zod';

const ethiopianPhone = z
  .string()
  .min(9)
  .max(20)
  .regex(/^(\+?251|0)?[79]\d{8}$/, 'Invalid Ethiopian phone number');

export const adminRequestUpdateSchema = z.object({
  status: z
    .enum([
      'pending',
      'reviewing',
      'sourcing',
      'found',
      'closed',
      'approved',
      'rejected',
      'fulfilled',
    ])
    .optional(),
  admin_notes: z.string().max(5000).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  urgency: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

export const adminNotifySchema = z
  .object({
    message: z.string().min(1).max(500).optional(),
    text: z.string().min(1).max(500).optional(),
    body: z.string().min(1).max(500).optional(),
    admin_notes: z.string().min(1).max(500).optional(),
    notes: z.string().min(1).max(500).optional(),
  })
  .passthrough()
  .transform((v) => {
    const message =
      v.message || v.text || v.body || v.admin_notes || v.notes || '';
    return { message };
  })
  .superRefine((v, ctx) => {
    // Allow empty — controller will fall back to a default note
    if (v.message && v.message.length > 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: 500,
        type: 'string',
        inclusive: true,
        message: 'message too long',
        path: ['message'],
      });
    }
  });

export const adminListQuerySchema = z.object({
  status: z.string().optional(),
  urgency: z.string().optional(),
  search: z.string().optional(),
  seller_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminRejectSellerSchema = z
  .object({
    admin_notes: z.string().max(2000).optional().nullable(),
  })
  .passthrough()
  .optional()
  .default({});

export const sellerApplicationSchema = z.object({
  business_name: z.string().min(2).max(150),
  business_description: z.string().min(50).max(5000),
  phone: ethiopianPhone,
  business_type: z.enum(['individual', 'small_business', 'company']),
});

const sellerProductFieldsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional().default(''),
  price: z.coerce.number().positive(),
  // Accepted from clients but NOT written to DB (column may not exist)
  currency: z.string().optional(),
  category: z.string().min(1),
  sub_category: z.string().optional().default('Other'),
  subCategory: z.string().optional(),
  stock: z.coerce.number().int().min(0).optional(),
  quantity: z.coerce.number().int().min(0).optional(),
  images: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        try {
          return JSON.parse(val);
        } catch {
          return val ? [val] : [];
        }
      }
      return val ?? [];
    }, z.array(z.string()).optional())
    .default([]),
  image_url: z.string().optional(),
  imageUrl: z.string().optional(),
  url: z.string().optional(),
  is_available: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform((v) =>
      v === undefined ? true : v === true || v === 'true'
    ),
});

export const sellerProductCreateSchema = sellerProductFieldsSchema.superRefine(
  (val, ctx) => {
    if (!val.name && !val.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'name or title is required',
        path: ['name'],
      });
    }
  }
);

export const sellerProductUpdateSchema = sellerProductFieldsSchema.partial();

export const sellerOrderStatusSchema = z.object({
  status: z.enum(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled']),
});

export const sellerProfileUpdateSchema = z.object({
  business_name: z.string().min(2).max(150).optional(),
  business_description: z.string().max(5000).optional().nullable(),
  business_phone: z.string().min(9).max(15).optional().nullable(),
  seller_name: z.string().min(1).max(100).optional(),
  seller_bio: z.string().max(1000).optional().nullable(),
  phone: z.string().optional().nullable(),
});

export const sellerProductQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).optional().default('all'),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

/** Full UUID or short UI id like ec5905 / #ec5905 */
export const orderIdParamSchema = z.object({
  id: z.string().min(4).max(64),
});

export const adminOrderStatusSchema = z.object({
  status: z
    .enum([
      'pending',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'refunded',
      'paid',
    ])
    .optional(),
  payment_status: z
    .enum(['pending', 'paid', 'completed', 'failed', 'refunded'])
    .optional(),
});

export const sellerPermissionsSchema = z.object({
  receive_orders: z.boolean().optional(),
  receive_requests: z.boolean().optional(),
});
