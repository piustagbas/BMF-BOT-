import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NOTIFICATIONS_QUEUE } from '../redis/redis.module';
import { NotificationsService } from './notifications.service';

export type NotificationJobData = {
  title: string;
  body: string;
  notificationId: string;
  channel: 'telegram' | 'whatsapp' | 'email';
};

/** @deprecated alias */
export type TelegramJobData = NotificationJobData;

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<{ ok: boolean }> {
    this.logger.log(`Processing ${job.data.channel} job ${job.id}`);
    await this.notifications.deliverNotificationJob(job.data);
    return { ok: true };
  }
}
