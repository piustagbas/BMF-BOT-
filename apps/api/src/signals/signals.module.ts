import { Module } from '@nestjs/common';
import { SignalsController } from './signals.controller';
import { SignalsService } from './signals.service';
import { SafetyModule } from '../safety/safety.module';
import { SmartMoneyModule } from '../smart-money/smart-money.module';

@Module({
  imports: [SafetyModule, SmartMoneyModule],
  controllers: [SignalsController],
  providers: [SignalsService],
  exports: [SignalsService],
})
export class SignalsModule {}
