import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { stripeWebhook } from './controllers/payments.controller';
import routes from './routes';

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    })
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Telegram WebView / same-origin proxies may omit Origin
        if (!origin) {
          callback(null, true);
          return;
        }

        const allowed =
          env.CORS_ORIGINS.includes(origin) ||
          origin === env.FRONTEND_URL ||
          origin.endsWith('.vercel.app') ||
          origin.includes('web.telegram.org') ||
          env.isDev;

        if (allowed) {
          callback(null, true);
          return;
        }

        logger.warn(`CORS blocked origin: ${origin}`);
        callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Stripe webhook must receive the raw body for signature verification
  app.post(
    '/api/payments/stripe/webhook',
    express.raw({ type: 'application/json' }),
    stripeWebhook
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  if (env.isDev) {
    app.use(morgan('dev'));
  } else {
    app.use(
      morgan('combined', {
        stream: {
          write: (message) => logger.info(message.trim()),
        },
      })
    );
  }

  app.get('/', (_req, res) => {
    res.json({
      success: true,
      message: 'Welcome to KeltaFagebeya API (ክልታፋገብያ)',
      version: '1.0.0',
      build: 'order-status-apis-2026-09-20',
      docs: '/api/health',
      testNotification: '/api/test-notification',
    });
  });

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
