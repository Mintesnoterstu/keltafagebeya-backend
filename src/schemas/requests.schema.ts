import { z } from 'zod';

/**
 * Accept frontend shapes:
 * - { product_name, description, category, urgency, contact_phone, budget }
 * - { title, … } (title is accepted then mapped — never written to DB)
 * - { min_price, max_price } → price_range
 * - urgency: medium → normal
 */
export const createRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    product_name: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional().nullable(),
    budget: z.coerce.number().positive().optional().nullable(),
    min_price: z.coerce.number().optional().nullable(),
    max_price: z.coerce.number().optional().nullable(),
    price_range: z.string().max(100).optional().nullable(),
    category: z.string().min(1).max(100).optional().nullable(),
    urgency: z
      .string()
      .optional()
      .transform((v) => {
        const raw = (v || 'normal').toLowerCase().trim();
        if (raw === 'medium') return 'normal';
        if (['low', 'normal', 'high', 'urgent'].includes(raw)) return raw;
        return 'normal';
      }),
    contact_phone: z.string().max(30).optional().nullable(),
    phone: z.string().max(30).optional().nullable(),
    images: z.array(z.string()).optional().default([]),
  })
  .superRefine((val, ctx) => {
    if (!val.title && !val.product_name && !val.name && !val.description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'product_name or description is required',
        path: ['product_name'],
      });
    }
  })
  .transform((val) => {
    const productName = (val.product_name ||
      val.title ||
      val.name ||
      val.description ||
      'Product request') as string;

    let priceRange = val.price_range ?? null;
    if (!priceRange && (val.min_price != null || val.max_price != null)) {
      priceRange = `${val.min_price ?? ''}-${val.max_price ?? ''}`.replace(
        /^-|-$/g,
        ''
      );
    }

    const budget =
      val.budget ??
      (val.max_price != null
        ? Number(val.max_price)
        : val.min_price != null
          ? Number(val.min_price)
          : null);

    return {
      product_name: productName,
      description: val.description ?? null,
      budget,
      price_range: priceRange,
      category: val.category ?? null,
      urgency: (val.urgency || 'normal') as string,
      contact_phone: val.contact_phone || val.phone || null,
      images: val.images ?? [],
    };
  });

export const updateRequestSchema = z.object({
  status: z.enum([
    'pending',
    'reviewing',
    'sourcing',
    'found',
    'closed',
    'approved',
    'rejected',
    'fulfilled',
  ]),
  admin_notes: z.string().max(2000).optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

export const requestIdSchema = z.object({
  id: z.string().uuid(),
});
