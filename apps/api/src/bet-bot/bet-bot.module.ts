import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BetBotController } from './bet-bot.controller';
import { BetBotService } from './bet-bot.service';

@Module({
  imports: [AuthModule],
  controllers: [BetBotController],
  providers: [BetBotService],
})
export class BetBotModule {}
