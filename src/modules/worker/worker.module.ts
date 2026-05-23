import { Module } from '@nestjs/common';
import { ReplayWorker } from './worker.processor';
import { CheckpointModule } from '../checkpoint/checkpoint.module';
import { DeadLetterModule } from '../dead-letter/dead-letter.module';
import { ReplayRepository } from '../replay/replay.repository';

@Module({
  imports: [CheckpointModule, DeadLetterModule],
  providers: [ReplayWorker, ReplayRepository],
})
export class WorkerModule {}
