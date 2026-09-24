import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../data/smartbrowser.db');

export default {
  development: {
    client: 'better-sqlite3',
    connection: {
      filename: dbPath,
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve(__dirname, 'migrations'),
    },
  },
  production: {
    client: process.env.DB_CLIENT || 'better-sqlite3',
    connection: process.env.DATABASE_URL
      ? process.env.DATABASE_URL
      : {
          filename: dbPath,
        },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve(__dirname, 'migrations'),
    },
  },
};
