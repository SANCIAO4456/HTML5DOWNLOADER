import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import {
  DATA_DIR,
  DB_PATH,
  FRONTEND_DIST_DIR,
  OUTPUT_DIR,
  PORT,
} from './config.js';
import { FlipDownDatabase } from './db/database.js';
import { createApiRouter } from './routes/api.js';
import { JobManager } from './services/jobManager.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const db = new FlipDownDatabase(DB_PATH);
const interrupted = db.markInterruptedJobsFailed();
if (interrupted > 0) {
  console.log(`[FlipDown] Marked ${interrupted} interrupted job(s) as failed.`);
}

const jobManager = new JobManager(db, OUTPUT_DIR);
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/api', createApiRouter(db, jobManager));

if (fs.existsSync(FRONTEND_DIST_DIR)) {
  app.use(express.static(FRONTEND_DIST_DIR));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(FRONTEND_DIST_DIR, 'index.html'));
  });
}

const server = app.listen(PORT, () => {
  console.log('==========================================================');
  console.log('  FlipDown (FlipHTML5 Downloader) Server Active');
  console.log(`  Local   : http://localhost:${PORT}`);
  console.log(`  SQLite  : ${DB_PATH}`);
  console.log('==========================================================');
});

function shutdown(signal: string): void {
  console.log(`\n[FlipDown] Received ${signal}, shutting down cleanly...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
