import { app } from './app.js';
import { config } from './config.js';
import { initDb, db } from './db.js';
import { defaultIntegrityServer } from './integrityServer.js';

async function startServer() {
  try {
    await initDb();
    console.log(`[Database] SQLite connected at ${config.databasePath}`);

    const server = app.listen(config.port, () => {
      console.log(`[Server] Smart Browser API server listening on http://localhost:${config.port}`);
    });

    defaultIntegrityServer.attachToServer(server);
    console.log(`[Integrity] WebSocket endpoint active at ws://localhost:${config.port}/ws/integrity`);

    const shutdown = async () => {
      console.log('\n[Server] Shutting down gracefully...');
      try {
        defaultIntegrityServer.destroy();
      } catch {}

      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }

      server.close(async () => {
        try {
          await db.destroy();
        } catch {}
        console.log('[Server] Database closed and server terminated.');
        process.exit(0);
      });

      // Safety fallback to guarantee prompt termination
      setTimeout(() => process.exit(0), 500).unref();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[Server] Failed to initialize backend server:', err);
    process.exit(1);
  }
}

startServer();
