import { Module } from '@nestjs/common';
import { PaperController } from './paper.controller';
import { PaperService } from './paper.service';
import { SignalsModule } from '../signals/signals.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SignalsModule, AuthModule],
  controllers: [PaperController],
  providers: [PaperService],
  exports: [PaperService],
})
export class PaperModule {}
