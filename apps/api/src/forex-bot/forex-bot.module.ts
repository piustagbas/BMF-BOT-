import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ForexBotController } from './forex-bot.controller';
import { ForexBotService } from './forex-bot.service';

@Module({
  imports: [AuthModule],
  controllers: [ForexBotController],
  providers: [ForexBotService],
})
export class ForexBotModule {}

