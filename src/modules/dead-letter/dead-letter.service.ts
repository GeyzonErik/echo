import { Injectable, Inject } from '@nestjs/common';
import type { Sql } from 'postgres';
import { PG_CONNECTION } from '../../shared/database/database.module';
import { JsonObject } from 'src/shared/types/json.types';

export interface DeadLetter {
  id: string;
  replay_job_id: string;
  partition_index: number | null;
  event_id: string | null;
  stream: string | null;
  error: string | null;
  payload: JsonObject | null;
  failed_at: Date;
}

@Injectable()
export class DeadLetterService {
  constructor(@Inject(PG_CONNECTION) private readonly sql: Sql) {}

  async record(params: {
    replayJobId: string;
    partitionIndex: number;
    eventId: string;
    stream: string;
    error: Error;
    payload: JsonObject;
  }): Promise<void> {
    await this.sql`
      INSERT INTO dead_letters
        (replay_job_id, partition_index, event_id, stream, error, payload)
      VALUES
        (${params.replayJobId}, ${params.partitionIndex}, ${params.eventId},
         ${params.stream}, ${params.error.message}, ${this.sql.json(params.payload)})
    `;
  }

  async findByJob(replayJobId: string): Promise<DeadLetter[]> {
    return this.sql<DeadLetter[]>`
      SELECT * FROM dead_letters
      WHERE  replay_job_id = ${replayJobId}
      ORDER  BY failed_at DESC
      LIMIT  100
    `;
  }
}
