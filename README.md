# Echo

**Replay & Backfill Infrastructure for Event-Driven Systems**

Echo is a replay engine for distributed pipelines. Send one API request and it partitions the work, runs parallel workers, persists checkpoints, and recovers automatically from failures — without scripts, without manual coordination.

```bash
POST /replay
{
  "stream": "orders",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-01-31T23:59:59Z",
  "parallelism": 20
}
```

---

## The problem

Every event-driven system eventually needs to reprocess historical data. A business rule changed. A new service needs to be backfilled. A pipeline crashed halfway through two million events.

The typical solution: an engineer writes a script at 11pm. No checkpointing. No retry. No visibility. If it crashes, you start over.

Echo is the infrastructure that should have existed.

---

## How it works

```
POST /replay
     │
     ▼
PartitionerService
splits the time range into N equal chunks
     │
     ▼
BullMQ Queue
[partition-0] [partition-1] ... [partition-N]
     │
     ▼  (parallel workers)
ReplayWorker
reads events in batches · processes · saves checkpoint
     │
     ├── failure → DeadLetterQueue (payload preserved)
     └── success → Checkpoint updated (Redis + PostgreSQL)
```

Each partition runs independently. Workers checkpoint progress after every batch. If the process crashes mid-replay, it resumes from the last saved cursor — not from the beginning.

---

## Benchmarks

Tested locally against 50,192 events (6-month range, `orders` stream):

| parallelism | duration | throughput       |
| ----------- | -------- | ---------------- |
| 1           | 3,248ms  | ~15,400 events/s |
| 20          | 880ms    | ~57,000 events/s |

**3.7x faster** with parallel partitioning on the same machine and the same dataset.

> Hardware: local dev machine · PostgreSQL 16 + Redis 7 via Docker

---

## Key features

**Checkpoint + Resume** — progress is persisted to Redis (fast) and PostgreSQL (durable) after every batch. Kill the process mid-replay, restart, and it picks up exactly where it stopped.

**Dead-letter queue** — events that fail after all retries are written to a `dead_letters` table with the original payload and error message. Nothing is silently dropped.

**Automatic partitioning** — the engine divides any time range into N equal slices. Each partition is an independent BullMQ job with its own cursor and checkpoint.

**Deterministic execution** — the same replay request with the same parameters produces the same result. Cursor-based pagination (`ORDER BY id`) guarantees consistent ordering across restarts.

**Cancellation** — `POST /replay/:id/cancel` signals all active workers to stop gracefully at the next batch boundary.

---

## API

### Create a replay job

```
POST /replay
```

```json
{
  "stream": "orders",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-01-31T23:59:59Z",
  "parallelism": 4
}
```

Response `202 Accepted`:

```json
{
  "id": "uuid",
  "stream": "orders",
  "status": "pending",
  "parallelism": 4,
  "total_events": null,
  "processed": 0,
  "created_at": "2026-01-01T00:00:00Z"
}
```

### Get replay status

```
GET /replay/:id
```

```json
{
  "id": "uuid",
  "status": "completed",
  "total_events": 24958,
  "processed": 24958,
  "progress_pct": 100,
  "partitions": [
    {
      "partition_index": 0,
      "status": "completed",
      "processed": 6245,
      "last_event_id": "uuid"
    }
  ]
}
```

### Dead-letter inspection

```
GET /replay/:id/dead-letters
```

Returns up to 100 failed events with their original payload and error message.

### Cancel

```
POST /replay/:id/cancel
```

Signals active workers to stop at the next batch boundary. Returns `204 No Content`.

---

## Quick start

**Requirements:** Node.js 20+, pnpm, Docker

```bash
git clone https://github.com/GeyzonErik/echo.git
cd echo

cp .env.example .env

docker compose up -d

pnpm install

# Run migrations
docker exec -i echo_postgres psql -U echo -d echo < migrations/schema.sql

# Seed 100K events
pnpm seed

# Start
pnpm start:dev
```

The API is available at `http://localhost:3000`.
Bull Board (queue dashboard) is available at `http://localhost:3000/queues`.

---

## Schema

```sql
events         -- event source (stream, payload, occurred_at)
replay_jobs    -- one row per POST /replay request
checkpoints    -- one row per partition, tracks cursor and progress
dead_letters   -- failed events with payload and error preserved
```

---

## Stack

| Layer              | Technology                            |
| ------------------ | ------------------------------------- |
| Framework          | NestJS + TypeScript                   |
| Queue              | BullMQ                                |
| Cache / checkpoint | Redis (ioredis)                       |
| Database           | PostgreSQL (postgres driver — no ORM) |
| Infrastructure     | Docker Compose                        |
| Package manager    | pnpm                                  |

No ORM. Raw SQL with the `postgres` driver for predictable query behavior and explicit control over indexes.

---

## Project context

Echo formalizes patterns from production work: an ETL pipeline processing 21K+ blockchain events per day and parallel synchronization of 51 pools using GCP Cloud Tasks. The checkpoint-resume pattern, dead-letter handling, and cursor-based pagination are direct extractions from that experience.

---

## Roadmap

| V2  | Real connectors (Kafka, Redis Streams, SQS, RabbitMQ) |
| --- | ----------------------------------------------------- |
| V2  | Webhook notifications on job completion               |
| V2  | Rate limiting per replay job                          |
| V2  | Multi-stream replay in a single request               |
| V3  | SDK — embed Echo directly in your NestJS application  |
