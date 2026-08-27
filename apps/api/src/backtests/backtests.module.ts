import { Module } from '@nestjs/common';
import { BacktestsController } from './backtests.controller';
import { BacktestsService } from './backtests.service';
import { SignalsModule } from '../signals/signals.module';

@Module({
  imports: [SignalsModule],
  controllers: [BacktestsController],
  providers: [BacktestsService],
  exports: [BacktestsService],
})
export class BacktestsModule {}
