import { Injectable, Inject } from '@nestjs/common';
import type { Sql } from 'postgres';
import { PG_CONNECTION } from '../../shared/database/database.module';
import {
  ReplayJob,
  ReplayJobDetail,
  Checkpoint,
} from './entities/replay-job.entity';

@Injectable()
export class ReplayRepository {
  constructor(@Inject(PG_CONNECTION) private readonly sql: Sql) {}

  async create(params: {
    stream: string;
    from: Date;
    to: Date;
    parallelism: number;
  }): Promise<ReplayJob> {
    const [job] = await this.sql<ReplayJob[]>`
      INSERT INTO replay_jobs (stream, from_ts, to_ts, parallelism)
      VALUES (${params.stream}, ${params.from}, ${params.to}, ${params.parallelism})
      RETURNING *
    `;
    return job;
  }

  async countEvents(stream: string, from: Date, to: Date): Promise<number> {
    const [row] = await this.sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM events
      WHERE stream      = ${stream}
        AND occurred_at >= ${from}
        AND occurred_at <  ${to}
    `;
    return parseInt(row.count, 10);
  }

  async setTotalAndStatus(id: string, total: number): Promise<void> {
    await this.sql`
      UPDATE replay_jobs
      SET total_events = ${total},
          status       = 'running',
          updated_at   = NOW()
      WHERE id = ${id}
    `;
  }

  async updateStatus(id: string, status: ReplayJob['status']): Promise<void> {
    await this.sql`
      UPDATE replay_jobs
      SET status     = ${status},
          updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  async incrementProcessed(id: string, count: number): Promise<void> {
    await this.sql`
      UPDATE replay_jobs
      SET processed  = processed + ${count},
          updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  async findById(id: string): Promise<ReplayJob | null> {
    const [job] = await this.sql<ReplayJob[]>`
      SELECT * FROM replay_jobs WHERE id = ${id}
    `;
    return job ?? null;
  }

  async findDetailById(id: string): Promise<ReplayJobDetail | null> {
    const job = await this.findById(id);
    if (!job) return null;

    const partitions = await this.sql<Checkpoint[]>`
      SELECT * FROM checkpoints
      WHERE replay_job_id = ${id}
      ORDER BY partition_index
    `;

    const progress_pct =
      job.total_events && job.total_events > 0
        ? Math.round((job.processed / job.total_events) * 100)
        : 0;

    return {
      ...job,
      total_events: job.total_events ? Number(job.total_events) : null,
      processed: Number(job.processed),
      partitions: partitions.map((p) => ({
        ...p,
        processed: Number(p.processed),
      })),
      progress_pct,
    };
  }

  async createCheckpoints(params: {
    jobId: string;
    partitions: Array<{ index: number; from: Date; to: Date }>;
  }): Promise<void> {
    const rows = params.partitions.map((p) => ({
      replay_job_id: params.jobId,
      partition_index: p.index,
      from_ts: p.from,
      to_ts: p.to,
    }));

    await this.sql`
      INSERT INTO checkpoints ${this.sql(rows, 'replay_job_id', 'partition_index', 'from_ts', 'to_ts')}
    `;
  }
}
