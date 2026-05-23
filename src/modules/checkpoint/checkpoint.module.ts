import { Module } from '@nestjs/common';
import { CheckpointService } from './checkpoint.service';

@Module({
  providers: [CheckpointService],
  exports: [CheckpointService],
})
export class CheckpointModule {}
