import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate } from '../middleware/auth';
import {
  stripeCreateIntentSchema,
  chapaInitializeSchema,
  chapaVerifySchema,
} from '../schemas/payments.schema';
import * as paymentsController from '../controllers/payments.controller';

const router = Router();

router.post(
  '/stripe/create-intent',
  authenticate,
  validate(stripeCreateIntentSchema),
  paymentsController.createStripeIntent
);

// Stripe webhook is mounted in app.ts with express.raw() for signature verification

router.post(
  '/chapa/initialize',
  authenticate,
  validate(chapaInitializeSchema),
  paymentsController.initializeChapa
);

router.post('/chapa/webhook', paymentsController.chapaWebhook);

router.post(
  '/chapa/verify/:id',
  authenticate,
  validate(chapaVerifySchema, 'params'),
  paymentsController.verifyChapa
);

export default router;
