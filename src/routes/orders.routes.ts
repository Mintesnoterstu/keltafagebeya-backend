import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate, requireSeller } from '../middleware/auth';
import {
  createOrderSchema,
  updateOrderStatusSchema,
  orderIdSchema,
  orderQuerySchema,
} from '../schemas/orders.schema';
import * as ordersController from '../controllers/orders.controller';

const router = Router();

router.use(authenticate);

// Static routes before :id
router.get(
  '/seller',
  requireSeller,
  validate(orderQuerySchema, 'query'),
  ordersController.getSellerOrders
);

router.post('/', validate(createOrderSchema), ordersController.createOrder);

router.get(
  '/',
  validate(orderQuerySchema, 'query'),
  ordersController.getOrders
);

router.get(
  '/:id',
  validate(orderIdSchema, 'params'),
  ordersController.getOrderById
);

router.put(
  '/:id/status',
  requireSeller,
  validate(orderIdSchema, 'params'),
  validate(updateOrderStatusSchema),
  ordersController.updateOrderStatus
);

export default router;
