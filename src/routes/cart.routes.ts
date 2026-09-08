import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate } from '../middleware/auth';
import {
  addCartItemSchema,
  updateCartItemSchema,
  cartItemIdSchema,
} from '../schemas/cart.schema';
import * as cartController from '../controllers/cart.controller';

const router = Router();

router.use(authenticate);

router.get('/', cartController.getCart);

router.post('/', validate(addCartItemSchema), cartController.addToCart);

router.delete('/', cartController.clearCart);

router.put(
  '/:id',
  validate(cartItemIdSchema, 'params'),
  validate(updateCartItemSchema),
  cartController.updateCartItem
);

router.delete(
  '/:id',
  validate(cartItemIdSchema, 'params'),
  cartController.removeCartItem
);

export default router;
