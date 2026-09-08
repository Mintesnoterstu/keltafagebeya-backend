import { z } from 'zod';

export const createRequestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  budget: z.number().positive().optional().nullable(),
  category: z.string().optional().nullable(),
  images: z.array(z.string().url()).default([]),
});

export const updateRequestSchema = z.object({
  status: z.enum(['pending', 'reviewing', 'approved', 'rejected', 'fulfilled']),
  admin_notes: z.string().max(2000).optional().nullable(),
});

export const requestIdSchema = z.object({
  id: z.string().uuid(),
});
