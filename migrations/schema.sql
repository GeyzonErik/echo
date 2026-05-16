-- ============================================================
-- Echo — Database Schema v1
-- Usage: psql $DATABASE_URL -f migrations/schema.sql
-- ============================================================

-- 001: events
-- Simula qualquer event store (Kafka topic, Redis Stream, etc.)
CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream      TEXT NOT NULL,
  payload     JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice composto: stream + tempo é o padrão de acesso do worker
-- Sem ele: full scan em cada batch. Com ele: index range scan.
CREATE INDEX IF NOT EXISTS idx_events_stream_time
  ON events (stream, occurred_at);

-- 002: replay_jobs
-- Um registro por requisição POST /replay
CREATE TABLE IF NOT EXISTS replay_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream       TEXT NOT NULL,
  from_ts      TIMESTAMPTZ NOT NULL,
  to_ts        TIMESTAMPTZ NOT NULL,
  parallelism  INT NOT NULL DEFAULT 4,
  status       TEXT NOT NULL DEFAULT 'pending',
  -- pending | running | completed | failed | cancelled
  total_events BIGINT,
  processed    BIGINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 003: checkpoints
-- Um registro por partição por job — permite resume após falha
CREATE TABLE IF NOT EXISTS checkpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  replay_job_id   UUID NOT NULL REFERENCES replay_jobs(id) ON DELETE CASCADE,
  partition_index INT NOT NULL,
  from_ts         TIMESTAMPTZ NOT NULL,
  to_ts           TIMESTAMPTZ NOT NULL,
  last_event_id   UUID,          -- cursor: onde parou na última batch
  processed       BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- pending | running | completed | failed
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (replay_job_id, partition_index)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_job
  ON checkpoints (replay_job_id);

-- 004: dead_letters
-- Eventos que falharam após todos os retries
CREATE TABLE IF NOT EXISTS dead_letters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  replay_job_id   UUID NOT NULL REFERENCES replay_jobs(id) ON DELETE CASCADE,
  partition_index INT,
  event_id        UUID,
  stream          TEXT,
  error           TEXT,
  payload         JSONB,
  failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letters_job
  ON dead_letters (replay_job_id);