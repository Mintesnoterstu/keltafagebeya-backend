import { Router } from 'express';
import { validate } from '../middleware/errorHandler';
import { authenticate } from '../middleware/auth';
import { createFeedbackSchema } from '../schemas/feedback.schema';
import * as feedbackController from '../controllers/feedback.controller';

const router = Router();

router.use(authenticate);

router.post('/', validate(createFeedbackSchema), feedbackController.createFeedback);

export default router;
