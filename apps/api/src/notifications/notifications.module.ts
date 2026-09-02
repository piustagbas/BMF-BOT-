import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NOTIFICATIONS_QUEUE } from '../redis/redis.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { TradeNotificationsService } from './trade-notifications.service';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }), AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor, TradeNotificationsService],
  exports: [NotificationsService, TradeNotificationsService],
})
export class NotificationsModule {}
