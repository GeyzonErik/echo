import { Injectable, Inject } from '@nestjs/common';
import type { Sql } from 'postgres';
import Redis from 'ioredis';
import { PG_CONNECTION } from '../../shared/database/database.module';
import { REDIS_CLIENT } from '../../shared/redis/redis.module';

@Injectable()
export class CheckpointService {
  constructor(
    @Inject(PG_CONNECTION) private readonly sql: Sql,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Return the last processed event_id for a given partition.
   * First checks Redis for a fast response, then falls back to PostgreSQL for durability.
   */
  async getLastEventId(
    jobId: string,
    partitionIndex: number,
  ): Promise<string | null> {
    const cached = await this.redis.get(this.key(jobId, partitionIndex));
    if (cached) return cached;

    const [row] = await this.sql<{ last_event_id: string | null }[]>`
      SELECT last_event_id FROM checkpoints
      WHERE replay_job_id   = ${jobId}
        AND partition_index = ${partitionIndex}
    `;
    return row?.last_event_id ?? null;
  }

  /**
   * Persists the checkpoint for a given partition.
   * Redis: immediate write after each batch for fast access.
   * PostgreSQL: durable write to survive restarts and provide a reliable source of truth.
   */
  async save(params: {
    jobId: string;
    partitionIndex: number;
    lastEventId: string;
    processedCount: number;
  }): Promise<void> {
    const { jobId, partitionIndex, lastEventId, processedCount } = params;

    await this.redis.set(
      this.key(jobId, partitionIndex),
      lastEventId,
      'EX',
      3_600,
    );

    await this.sql`
      UPDATE checkpoints
      SET last_event_id = ${lastEventId},
          processed     = processed + ${processedCount},
          status        = 'running',
          updated_at    = NOW()
      WHERE replay_job_id   = ${jobId}
        AND partition_index = ${partitionIndex}
    `;
  }

  async markComplete(jobId: string, partitionIndex: number): Promise<void> {
    await this.redis.del(this.key(jobId, partitionIndex));
    await this.sql`
      UPDATE checkpoints
      SET status     = 'completed',
          updated_at = NOW()
      WHERE replay_job_id   = ${jobId}
        AND partition_index = ${partitionIndex}
    `;
  }

  async markFailed(jobId: string, partitionIndex: number): Promise<void> {
    await this.sql`
      UPDATE checkpoints
      SET status     = 'failed',
          updated_at = NOW()
      WHERE replay_job_id   = ${jobId}
        AND partition_index = ${partitionIndex}
    `;
  }

  private key(jobId: string, partitionIndex: number): string {
    return `echo:checkpoint:${jobId}:${partitionIndex}`;
  }
}
