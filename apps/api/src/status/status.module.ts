import { Module } from '@nestjs/common';
import { TradingModule } from '../trading/trading.module';
import { StatusController } from './status.controller';

@Module({
  imports: [TradingModule],
  controllers: [StatusController],
})
export class StatusModule {}
