import { Injectable } from '@nestjs/common';

export interface TimePartition {
  index: number;
  from: Date;
  to: Date;
}

@Injectable()
export class PartitionerService {
  /**
   * Divide a time range into N equal slices.
   * The last partition absorbs the rounding remainder.
   */
  partition(from: Date, to: Date, parallelism: number): TimePartition[] {
    const totalMs = to.getTime() - from.getTime();
    const chunkMs = Math.floor(totalMs / parallelism);

    return Array.from({ length: parallelism }, (_, i) => ({
      index: i,
      from: new Date(from.getTime() + i * chunkMs),
      to:
        i === parallelism - 1
          ? to
          : new Date(from.getTime() + (i + 1) * chunkMs),
    }));
  }
}
