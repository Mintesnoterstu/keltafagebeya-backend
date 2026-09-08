import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate, requireSeller } from '../middleware/auth';
import { updateSellerProfileSchema } from '../schemas/payments.schema';
import * as sellerController from '../controllers/seller.controller';

const router = Router();

router.use(authenticate);

router.get('/stats', requireSeller, sellerController.getSellerStats);

router.get('/products', requireSeller, sellerController.getSellerProducts);

router.put(
  '/profile',
  validate(updateSellerProfileSchema),
  sellerController.updateSellerProfile
);

export default router;
