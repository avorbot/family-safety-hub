import { createApp } from './app.js';
import { openDatabase } from './db.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a port number, got "${process.env.PORT}"`);
}
const databasePath = process.env.DATABASE_PATH ?? 'data/family-safety-hub.db';
const production = process.env.NODE_ENV === 'production';

const db = openDatabase(databasePath);
const app = createApp({ db, secureCookies: production, webDir: process.env.WEB_DIR ?? 'dist/web' });

const server = app.listen(port, () => {
  console.log(`Family Safety Hub API listening on http://localhost:${port} (database: ${databasePath})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
