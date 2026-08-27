import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [NotificationsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
