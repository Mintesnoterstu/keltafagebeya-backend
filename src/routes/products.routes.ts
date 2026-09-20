import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate, requireSeller, optionalAuth } from '../middleware/auth';
import {
  createProductSchema,
  updateProductSchema,
  productQuerySchema,
  productIdSchema,
} from '../schemas/products.schema';
import { createReviewSchema } from '../schemas/feedback.schema';
import * as productsController from '../controllers/products.controller';
import * as reviewsController from '../controllers/reviews.controller';

const router = Router();

// Static routes before :id
router.get('/categories', productsController.getCategories);

router.get(
  '/',
  validate(productQuerySchema, 'query'),
  optionalAuth,
  productsController.getProducts
);

router.get(
  '/:id',
  validate(productIdSchema, 'params'),
  productsController.getProductById
);

router.get(
  '/:id/reviews',
  validate(productIdSchema, 'params'),
  reviewsController.getProductReviews
);

router.post(
  '/:id/reviews',
  authenticate,
  validate(productIdSchema, 'params'),
  validate(createReviewSchema),
  reviewsController.createProductReview
);

router.post(
  '/',
  authenticate,
  requireSeller,
  validate(createProductSchema),
  productsController.createProduct
);

router.put(
  '/:id',
  authenticate,
  requireSeller,
  validate(productIdSchema, 'params'),
  validate(updateProductSchema),
  productsController.updateProduct
);

router.delete(
  '/:id',
  authenticate,
  requireSeller,
  validate(productIdSchema, 'params'),
  productsController.deleteProduct
);

export default router;
