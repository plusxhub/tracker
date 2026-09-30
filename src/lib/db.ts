import postgres from 'postgres';

let client: postgres.Sql | undefined;

/** Lazily created so `astro build` does not need a database. */
export function db(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_URL ?? import.meta.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = postgres(url, { max: 4, idle_timeout: 30, connect_timeout: 10, onnotice: () => {} });
  }
  return client;
}
