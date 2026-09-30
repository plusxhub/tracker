// Applies db/migrations/*.sql in order, each in its own transaction.
//   bun run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_OWNER_URL;
if (!url) {
  console.error('DATABASE_OWNER_URL is not set (see .env.example)');
  process.exit(1);
}

const dir = join(import.meta.dir, '..', 'db', 'migrations');
const sql = postgres(url, { onnotice: () => {} });

try {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
    applied++;
  }
  console.log(applied ? `${applied} migration(s) applied` : 'schema is up to date');
} finally {
  await sql.end();
}
