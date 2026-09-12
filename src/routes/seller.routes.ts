import { Router } from 'express';
import multer from 'multer';
import { validate } from '../middleware/errorHandler';
import { authenticate, requireSeller } from '../middleware/auth';
import {
  sellerApplicationSchema,
  sellerProductCreateSchema,
  sellerProductUpdateSchema,
  sellerOrderStatusSchema,
  sellerProfileUpdateSchema,
  sellerProductQuerySchema,
  idParamSchema,
} from '../schemas/admin.schema';
import { orderQuerySchema } from '../schemas/orders.schema';
import * as sellerController from '../controllers/seller.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

const router = Router();

router.use(authenticate);

// Customer-accessible application routes (before requireSeller)
router.post(
  '/apply',
  validate(sellerApplicationSchema),
  sellerController.applyAsSeller
);
router.get('/application-status', sellerController.getApplicationStatus);

// Seller-protected routes
router.get('/stats', requireSeller, sellerController.getSellerStats);

router.get(
  '/products',
  requireSeller,
  validate(sellerProductQuerySchema, 'query'),
  sellerController.getSellerProducts
);
router.post(
  '/products',
  requireSeller,
  upload.array('images', 5),
  validate(sellerProductCreateSchema),
  sellerController.createSellerProduct
);
router.put(
  '/products/:id',
  requireSeller,
  validate(idParamSchema, 'params'),
  upload.array('images', 5),
  validate(sellerProductUpdateSchema),
  sellerController.updateSellerProduct
);
router.delete(
  '/products/:id',
  requireSeller,
  validate(idParamSchema, 'params'),
  sellerController.deleteSellerProduct
);

router.get(
  '/orders',
  requireSeller,
  validate(orderQuerySchema, 'query'),
  sellerController.getSellerOrders
);
router.put(
  '/orders/:id/status',
  requireSeller,
  validate(idParamSchema, 'params'),
  validate(sellerOrderStatusSchema),
  sellerController.updateSellerOrderStatus
);

router.get('/profile', requireSeller, sellerController.getSellerProfile);
router.put(
  '/profile',
  requireSeller,
  validate(sellerProfileUpdateSchema),
  sellerController.updateSellerProfile
);

export default router;
