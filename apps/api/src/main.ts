import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function loadRootEnv() {
  const candidates = [
    join(__dirname, '../../../.env'),
    join(__dirname, '../../.env'),
    join(process.cwd(), '.env'),
    join(process.cwd(), '../../.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadEnv({ path, override: true });
      // eslint-disable-next-line no-console
      console.log(`Loaded env from ${path}`);
      return;
    }
  }
}

loadRootEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Behind ngrok / reverse proxies (LinguaAICall pattern)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'ngrok-skip-browser-warning',
    ],
  });

  const port = Number(process.env.PORT ?? process.env.APP_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Memecoinbot API listening on http://localhost:${port}/api`);
  // eslint-disable-next-line no-console
  console.log(
    `Mongo: ${process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/memecoinbot'}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `Telegram: ${process.env.TELEGRAM_BOT_TOKEN ? 'token loaded' : 'not configured'}`,
  );
  // eslint-disable-next-line no-console
  console.log('Trading mode default: SIGNAL_ONLY | Auto trading: OFF | Kill switch: ON');
}

void bootstrap();
