import { Controller, Get, Param } from '@nestjs/common';
import { SafetyService } from './safety.service';

@Controller('tokens')
export class SafetyController {
  constructor(private readonly safetyService: SafetyService) {}

  @Get(':address/safety')
  getSafety(@Param('address') address: string) {
    return this.safetyService.analyzeOrThrow(address);
  }
}
