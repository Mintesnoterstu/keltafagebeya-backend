import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { verifyTelegramBotToken } from './config/verifyTelegram';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 KeltaFagebeya API running on port ${env.PORT}`);
  logger.info(`📦 Environment: ${env.NODE_ENV}`);
  logger.info(`🌐 Frontend: ${env.FRONTEND_URL}`);
  void verifyTelegramBotToken();
});

function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});
