import { Module } from '@nestjs/common';
import { SignalsModule } from '../signals/signals.module';
import { TradingController } from './trading.controller';
import { TradingService } from './trading.service';
import { AutoTradingService } from './auto-trading.service';

@Module({
  imports: [SignalsModule],
  controllers: [TradingController],
  providers: [TradingService, AutoTradingService],
  exports: [TradingService, AutoTradingService],
})
export class TradingModule {}
