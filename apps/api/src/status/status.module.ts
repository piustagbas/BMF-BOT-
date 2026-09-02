import { Module } from '@nestjs/common';
import { TradingModule } from '../trading/trading.module';
import { StatusController } from './status.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TradingModule, AuthModule],
  controllers: [StatusController],
})
export class StatusModule {}
