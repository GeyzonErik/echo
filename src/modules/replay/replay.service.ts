import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateReplayDto } from './dto/create-replay.dto';
import { ReplayRepository } from './replay.repository';
import { PartitionerService } from '../partitioner/partitioner.service';
import { ReplayJob, ReplayJobDetail } from './entities/replay-job.entity';

export const REPLAY_QUEUE = 'echo_replay';

export interface ReplayJobPayload {
  replayJobId: string;
  partitionIndex: number;
  stream: string;
  from: string;
  to: string;
}

@Injectable()
export class ReplayService {
  constructor(
    private readonly replayRepo: ReplayRepository,
    private readonly partitioner: PartitionerService,
    @InjectQueue(REPLAY_QUEUE) private readonly queue: Queue<ReplayJobPayload>,
  ) {}

  async create(dto: CreateReplayDto): Promise<ReplayJob> {
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    const parallelism = dto.parallelism ?? 4;

    const job = await this.replayRepo.create({
      stream: dto.stream,
      from,
      to,
      parallelism,
    });

    // Bootstrap runs in background — HTTP has already responded
    void this.bootstrap(job.id, dto.stream, from, to, parallelism);

    return job;
  }

  async findOne(id: string): Promise<ReplayJobDetail> {
    const job = await this.replayRepo.findDetailById(id);
    if (!job) throw new NotFoundException(`Replay job ${id} not found`);
    return job;
  }

  async cancel(id: string): Promise<void> {
    const job = await this.replayRepo.findById(id);
    if (!job) throw new NotFoundException(`Replay job ${id} not found`);
    if (!['pending', 'running'].includes(job.status)) return;
    await this.replayRepo.updateStatus(id, 'cancelled');
  }

  private async bootstrap(
    jobId: string,
    stream: string,
    from: Date,
    to: Date,
    parallelism: number,
  ): Promise<void> {
    try {
      const total = await this.replayRepo.countEvents(stream, from, to);
      const partitions = this.partitioner.partition(from, to, parallelism);

      await this.replayRepo.setTotalAndStatus(jobId, total);
      await this.replayRepo.createCheckpoints({ jobId, partitions });

      await this.queue.addBulk(
        partitions.map((p) => ({
          name: `partition:${p.index}`,
          data: {
            replayJobId: jobId,
            partitionIndex: p.index,
            stream,
            from: p.from.toISOString(),
            to: p.to.toISOString(),
          },
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2_000 },
          },
        })),
      );
    } catch {
      await this.replayRepo.updateStatus(jobId, 'failed');
    }
  }
}
