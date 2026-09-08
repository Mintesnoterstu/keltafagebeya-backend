import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  createRequestSchema,
  updateRequestSchema,
  requestIdSchema,
} from '../schemas/requests.schema';
import * as requestsController from '../controllers/requests.controller';

const router = Router();

router.use(authenticate);

router.post('/', validate(createRequestSchema), requestsController.createRequest);

router.get('/', requestsController.getRequests);

router.get(
  '/:id',
  validate(requestIdSchema, 'params'),
  requestsController.getRequestById
);

router.put(
  '/:id',
  requireAdmin,
  validate(requestIdSchema, 'params'),
  validate(updateRequestSchema),
  requestsController.updateRequest
);

export default router;
