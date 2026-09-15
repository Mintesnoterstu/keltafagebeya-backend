import { z } from 'zod';

export const telegramAuthSchema = z
  .object({
    initData: z.string().min(1).optional(),
    init_data: z.string().min(1).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.initData && !val.init_data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'initData is required',
        path: ['initData'],
      });
    }
  })
  .transform((val) => ({
    initData: (val.initData || val.init_data) as string,
  }));
