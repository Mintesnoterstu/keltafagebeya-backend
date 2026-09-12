import { z } from 'zod';

/**
 * Accept both frontend shapes:
 * - { title, description, category, urgency }
 * - { product_name, description, category, urgency }
 */
export const createRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    product_name: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional().nullable(),
    budget: z.coerce.number().positive().optional().nullable(),
    category: z.string().min(1).max(100).optional().nullable(),
    urgency: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    images: z.array(z.string().url()).optional().default([]),
  })
  .superRefine((val, ctx) => {
    if (!val.title && !val.product_name && !val.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'title, product_name, or name is required',
        path: ['title'],
      });
    }
  })
  .transform((val) => ({
    title: (val.title || val.product_name || val.name) as string,
    description: val.description ?? null,
    budget: val.budget ?? null,
    category: val.category ?? null,
    urgency: val.urgency,
    images: val.images ?? [],
  }));

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
