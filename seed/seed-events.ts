/**
 * Echo — Seed Script
 * Generate realistic events for local dev and benchmarks.
 *
 * Usage: npx ts-node seed/seed-events.ts
 * Output: ~100K events in 3 streams over 6 months
 */
// import 'dotenv/config';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { randomUUID } from 'crypto';

dotenv.config();

const sql = postgres({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'echo',
  password: process.env.POSTGRES_PASSWORD ?? 'echo',
  database: process.env.POSTGRES_DB ?? 'echo',
});

// ── JSON Types ─────────────────────────────────────────────
// This represents any valid JSON value, which is what the postgres driver accepts for JSONB columns.
type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonArray | JsonObject;

// ── Contracts ──

interface OrderPayload extends JsonObject {
  order_id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: string;
  items: number;
}

interface PaymentPayload extends JsonObject {
  payment_id: string;
  order_id: string;
  amount: number;
  method: string;
  status: string;
  gateway_ref: string;
}

interface NotificationPayload extends JsonObject {
  notification_id: string;
  user_id: string;
  type: string;
  template: string;
  delivered: boolean;
}

// Contrato base para inserção — o que o driver postgres aceita
interface EventRow {
  id: string;
  stream: string;
  payload: JsonObject;
  occurred_at: string;
}

// ── Config ────────────────────────────────────────────────

const STREAMS = [
  { name: 'orders', weight: 0.5 },
  { name: 'payments', weight: 0.3 },
  { name: 'notifications', weight: 0.2 },
];

const TOTAL_EVENTS = 100_000;
const BATCH_SIZE = 1_000;

// 6 months window until today
const TO = new Date();
const FROM = new Date(TO.getTime() - 180 * 24 * 60 * 60 * 1000);

function ordersPayload(): OrderPayload {
  const statuses = ['created', 'paid', 'shipped', 'delivered', 'cancelled'];
  return {
    order_id: randomUUID(),
    user_id: randomUUID(),
    amount: parseFloat((Math.random() * 500 + 10).toFixed(2)),
    currency: 'BRL',
    status: statuses[Math.floor(Math.random() * statuses.length)],
    items: Math.floor(Math.random() * 5) + 1,
  };
}

function paymentsPayload(): PaymentPayload {
  const methods = ['pix', 'credit_card', 'boleto'];
  return {
    payment_id: randomUUID(),
    order_id: randomUUID(),
    amount: parseFloat((Math.random() * 500 + 10).toFixed(2)),
    method: methods[Math.floor(Math.random() * methods.length)],
    status: Math.random() > 0.05 ? 'approved' : 'failed',
    gateway_ref: `GW-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  };
}

function notificationsPayload(): NotificationPayload {
  const types = ['email', 'sms', 'push'];
  return {
    notification_id: randomUUID(),
    user_id: randomUUID(),
    type: types[Math.floor(Math.random() * types.length)],
    template: 'order_confirmation',
    delivered: Math.random() > 0.02,
  };
}

const payloadByStream: Record<string, () => JsonObject> = {
  orders: ordersPayload,
  payments: paymentsPayload,
  notifications: notificationsPayload,
};

// Helpers

function pickStream(): string {
  const rand = Math.random();
  let acc = 0;
  for (const s of STREAMS) {
    acc += s.weight;
    if (rand < acc) return s.name;
  }
  return STREAMS[0].name;
}

function randomDate(from: Date, to: Date): Date {
  return new Date(
    from.getTime() + Math.random() * (to.getTime() - from.getTime()),
  );
}

function progressBar(current: number, total: number): string {
  const pct = (current / total) * 100;
  const filled = Math.floor(pct / 5);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  return `[${bar}] ${pct.toFixed(1)}% (${current.toLocaleString()}/${total.toLocaleString()})`;
}

// Main

async function seed() {
  console.log('🌱 Echo seed starting...');
  console.log(`   Events : ${TOTAL_EVENTS.toLocaleString()}`);
  console.log(
    `   Range  : ${FROM.toISOString().slice(0, 10)} → ${TO.toISOString().slice(0, 10)}\n`,
  );

  console.log(sql.options.host);
  console.log(sql.options.port);
  console.log(sql.options.pass);

  await sql`TRUNCATE TABLE events RESTART IDENTITY CASCADE`;
  console.log('   ✓ Cleared existing events\n');

  const start = Date.now();
  let inserted = 0;

  while (inserted < TOTAL_EVENTS) {
    const batchCount = Math.min(BATCH_SIZE, TOTAL_EVENTS - inserted);

    const rows: EventRow[] = Array.from({ length: batchCount }, () => {
      const stream = pickStream();
      return {
        id: randomUUID(),
        stream,
        payload: payloadByStream[stream](),
        occurred_at: randomDate(FROM, TO).toISOString(),
      };
    });

    await sql`
      INSERT INTO events ${sql(rows, 'id', 'stream', 'payload', 'occurred_at')}
    `;

    inserted += batchCount;
    process.stdout.write(`\r   ${progressBar(inserted, TOTAL_EVENTS)}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(
    `\n\n✅ Seeded ${TOTAL_EVENTS.toLocaleString()} events in ${elapsed}s`,
  );

  const counts = await sql<{ stream: string; count: string }[]>`
    SELECT stream, COUNT(*)::text FROM events GROUP BY stream ORDER BY stream
  `;

  console.log('\n   Breakdown:');
  for (const row of counts) {
    console.log(
      `   → ${row.stream.padEnd(16)} ${Number(row.count).toLocaleString()} events`,
    );
  }

  await sql.end();
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

seed().catch((err) => {
  console.error('\n❌ Seed failed:', toError(err).message);
  process.exit(1);
});
