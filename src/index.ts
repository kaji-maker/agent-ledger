import dotenv from "dotenv";
dotenv.config();

// Access the key anywhere using process.env
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("GEMINI_API_KEY is not set in your .env file!");
}

import express from 'express';
import { apiRouter } from './api/routes.js';
import { initializeDatabase } from './db/schema.js';
import { healthCheck } from './db/index.js';

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));
app.use('/api', apiRouter);

// Start server
async function main() {
  console.log('Starting AgentLedger system...');

  const dbConnected = await healthCheck();
  if (dbConnected) {
    console.log('Connected to PostgreSQL successfully.');
    await initializeDatabase();
  } else {
    console.warn('Warning: PostgreSQL connection failed or unavailable. Falling back to resilient in-memory verification mode.');
  }

  app.listen(port, () => {
    console.log(`AgentLedger API service is listening on port ${port}`);
    console.log(`- Health Check: http://localhost:${port}/api/health`);
    console.log(`- MCP Tools ready for Gemini 3.5 Pro reconciliation`);
  });
}

main().catch((err) => {
  console.error('Fatal error during AgentLedger startup:', err);
});
