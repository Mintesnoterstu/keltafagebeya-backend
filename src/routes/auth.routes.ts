import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate } from '../middleware/auth';
import { telegramAuthSchema } from '../schemas/auth.schema';
import * as authController from '../controllers/auth.controller';

const router = Router();

router.post(
  '/telegram',
  validate(telegramAuthSchema),
  authController.telegramAuth
);

router.get('/me', authenticate, authController.getMe);

router.get('/config', authController.getConfig);

export default router;
