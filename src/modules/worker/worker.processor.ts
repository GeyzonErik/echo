import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import type { Sql } from 'postgres';
import { PG_CONNECTION } from '../../shared/database/database.module';
import { ReplayJobPayload, REPLAY_QUEUE } from '../replay/replay.service';
import { CheckpointService } from '../checkpoint/checkpoint.service';
import { DeadLetterService } from '../dead-letter/dead-letter.service';
import { ReplayRepository } from '../replay/replay.repository';
import { JsonObject } from '../../shared/types/json.types';

const BATCH_SIZE = 500;

interface RawEvent {
  id: string;
  stream: string;
  payload: JsonObject;
  occurred_at: Date;
}

@Processor(REPLAY_QUEUE, { concurrency: 4 })
export class ReplayWorker extends WorkerHost {
  private readonly logger = new Logger(ReplayWorker.name);

  constructor(
    @Inject(PG_CONNECTION) private readonly sql: Sql,
    private readonly checkpoint: CheckpointService,
    private readonly deadLetter: DeadLetterService,
    private readonly replayRepo: ReplayRepository,
  ) {
    super();
  }

  async process(job: Job<ReplayJobPayload>): Promise<void> {
    const { replayJobId, partitionIndex, stream, from, to } = job.data;

    this.logger.log(`[${replayJobId}] partition ${partitionIndex} started`);

    // Abort if job was cancelled before starting
    const replayJob = await this.replayRepo.findById(replayJobId);
    if (replayJob?.status === 'cancelled') {
      this.logger.warn(
        `[${replayJobId}] partition ${partitionIndex} skipped — cancelled`,
      );
      return;
    }

    // Continue from last checkpoint (if exists) or from the start of the partition range
    let cursor = await this.checkpoint.getLastEventId(
      replayJobId,
      partitionIndex,
    );
    let processed = 0;

    while (true) {
      // Check for cancellation before each batch — allows responsive shutdown
      const current = await this.replayRepo.findById(replayJobId);
      if (current?.status === 'cancelled') break;

      const events = await this.fetchBatch({ stream, from, to, cursor });
      if (events.length === 0) break;

      let batchProcessed = 0;
      for (const event of events) {
        try {
          await this.handleEvent(event);
          batchProcessed++;
        } catch (err) {
          await this.deadLetter.record({
            replayJobId,
            partitionIndex,
            eventId: event.id,
            stream: event.stream,
            error: err instanceof Error ? err : new Error(String(err)),
            payload: event.payload,
          });
        }
      }

      cursor = events[events.length - 1].id;
      processed += batchProcessed;

      // Persists checkpoint after each batch — ensures resume capability with minimal reprocessing on failure
      await this.checkpoint.save({
        jobId: replayJobId,
        partitionIndex,
        lastEventId: cursor,
        processedCount: batchProcessed,
      });

      await this.replayRepo.incrementProcessed(replayJobId, batchProcessed);

      this.logger.debug(
        `[${replayJobId}] partition ${partitionIndex} — +${batchProcessed} (total: ${processed})`,
      );

      if (events.length < BATCH_SIZE) break; // Last batch — exit loop
    }

    await this.checkpoint.markComplete(replayJobId, partitionIndex);
    await this.maybeCompleteJob(replayJobId);

    this.logger.log(
      `[${replayJobId}] partition ${partitionIndex} done — ${processed} events`,
    );
  }

  /**
   * Simulates event processing. Replace with real logic:
   * reindexing, projection, forwarding to another service, etc.
   *
   */
  protected async handleEvent(_event: RawEvent): Promise<void> {
    // No-op for MVP — simulates processing without overhead
    await Promise.resolve();
  }

  private async fetchBatch(params: {
    stream: string;
    from: string;
    to: string;
    cursor: string | null;
  }): Promise<RawEvent[]> {
    const { stream, from, to, cursor } = params;

    if (cursor) {
      return this.sql<RawEvent[]>`
        SELECT id, stream, payload, occurred_at
        FROM   events
        WHERE  stream      = ${stream}
          AND  occurred_at >= ${new Date(from)}
          AND  occurred_at <  ${new Date(to)}
          AND  id > ${cursor}
        ORDER BY id
        LIMIT ${BATCH_SIZE}
      `;
    }

    return this.sql<RawEvent[]>`
      SELECT id, stream, payload, occurred_at
      FROM   events
      WHERE  stream      = ${stream}
        AND  occurred_at >= ${new Date(from)}
        AND  occurred_at <  ${new Date(to)}
      ORDER BY id
      LIMIT ${BATCH_SIZE}
    `;
  }

  private async maybeCompleteJob(jobId: string): Promise<void> {
    const [row] = await this.sql<{ pending: string }[]>`
      SELECT COUNT(*)::text AS pending
      FROM   checkpoints
      WHERE  replay_job_id = ${jobId}
        AND  status != 'completed'
    `;

    if (Number(row.pending) === 0) {
      await this.replayRepo.updateStatus(jobId, 'completed');
      this.logger.log(`[${jobId}] ALL partitions complete ✓`);
    }
  }
}
