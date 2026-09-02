import { Module } from '@nestjs/common';
import { SignalsModule } from '../signals/signals.module';
import { AuthModule } from '../auth/auth.module';
import { PaperModule } from '../paper/paper.module';
import { TradingController } from './trading.controller';
import { TradingService } from './trading.service';
import { AutoTradingService } from './auto-trading.service';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';
import { TpslMonitorService } from './tpsl.monitor';

@Module({
  imports: [SignalsModule, AuthModule, PaperModule],
  controllers: [TradingController, SwapController],
  providers: [TradingService, AutoTradingService, SwapService, TpslMonitorService],
  exports: [TradingService, AutoTradingService, SwapService],
})
export class TradingModule {}
