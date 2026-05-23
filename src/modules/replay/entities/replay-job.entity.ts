export type ReplayStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PartitionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ReplayJob {
  id: string;
  stream: string;
  from_ts: Date;
  to_ts: Date;
  parallelism: number;
  status: ReplayStatus;
  total_events: number | null;
  processed: number;
  created_at: Date;
  updated_at: Date;
}

export interface Checkpoint {
  id: string;
  replay_job_id: string;
  partition_index: number;
  from_ts: Date;
  to_ts: Date;
  last_event_id: string | null;
  processed: number;
  status: PartitionStatus;
  updated_at: Date;
}

export interface ReplayJobDetail extends ReplayJob {
  partitions: Checkpoint[];
  progress_pct: number;
}
