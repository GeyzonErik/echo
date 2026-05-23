import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReplayController } from './replay.controller';
import { ReplayService, REPLAY_QUEUE } from './replay.service';
import { ReplayRepository } from './replay.repository';
import { PartitionerModule } from '../partitioner/partitioner.module';
import { WorkerModule } from '../worker/worker.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: REPLAY_QUEUE }),
    PartitionerModule,
    WorkerModule,
  ],
  controllers: [ReplayController],
  providers: [ReplayService, ReplayRepository],
  exports: [ReplayService, ReplayRepository],
})
export class ReplayModule {}
