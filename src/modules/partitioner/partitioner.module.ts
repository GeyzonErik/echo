import { Module } from '@nestjs/common';
import { PartitionerService } from './partitioner.service';

@Module({
  providers: [PartitionerService],
  exports: [PartitionerService],
})
export class PartitionerModule {}
