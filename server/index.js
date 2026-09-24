import { app } from './app.js';
import { config } from './config.js';
import { initDb, db } from './db.js';

async function startServer() {
  try {
    await initDb();
    console.log(`[Database] SQLite connected at ${config.databasePath}`);

    const server = app.listen(config.port, () => {
      console.log(`[Server] Smart Browser API server listening on http://localhost:${config.port}`);
    });

    const shutdown = async () => {
      console.log('\n[Server] Shutting down gracefully...');
      server.close(async () => {
        await db.destroy();
        console.log('[Server] Database closed and server terminated.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[Server] Failed to initialize backend server:', err);
    process.exit(1);
  }
}

startServer();
