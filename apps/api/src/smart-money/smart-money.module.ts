import { Module } from '@nestjs/common';
import { SafetyModule } from '../safety/safety.module';
import { SmartMoneyController } from './smart-money.controller';
import { SmartMoneyService } from './smart-money.service';

@Module({
  imports: [SafetyModule],
  controllers: [SmartMoneyController],
  providers: [SmartMoneyService],
  exports: [SmartMoneyService],
})
export class SmartMoneyModule {}
