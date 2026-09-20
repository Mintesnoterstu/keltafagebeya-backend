import { z } from 'zod';

export const createFeedbackSchema = z.object({
  category: z.enum(['product', 'seller', 'delivery', 'other']),
  related_to: z.string().max(200).optional().nullable(),
  message: z.string().min(1).max(4000),
  rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
});

export const createReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(2000).optional().nullable(),
});
