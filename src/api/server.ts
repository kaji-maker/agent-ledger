import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import { IngestAgent, ExtractedInvoice } from '../agent/ingest.js';
import { LedgerOrchestrator, ReActStep } from '../agent/orchestrator.js';
import {
  fetchLedgerAccounts,
  verifyTaxCompliance,
  postJournalEntry,
  flagDiscrepancyForReview,
  getDiscrepanciesList,
  resolveDiscrepancy,
} from '../mcp/ledgerTools.js';
import { healthCheck } from '../db/index.js';
import { initializeDatabase } from '../db/schema.js';

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

app.use(express.json({ limit: '15mb' }));

// Serve static assets from public/ directory
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

const ingestAgent = new IngestAgent();
const orchestrator = new LedgerOrchestrator();

// ==========================================
// 1. Health & Status Endpoints
// ==========================================

app.get('/api/health', async (_req: Request, res: Response) => {
  const dbAlive = await healthCheck();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    databaseConnected: dbAlive,
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
  });
});

// ==========================================
// 2. Ledger Accounts & Balances
// ==========================================

app.get('/api/ledger/accounts', async (req: Request, res: Response) => {
  try {
    const accountType = req.query.type as string | undefined;
    const result = await fetchLedgerAccounts({ accountType });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 3. Human-In-The-Loop Discrepancies Management
// ==========================================

app.get('/api/discrepancies', async (_req: Request, res: Response) => {
  try {
    const list = await getDiscrepanciesList();
    res.json({ success: true, discrepancies: list });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/discrepancies/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reference, description, amount, debitAccountId, creditAccountId } = req.body;

    let overrideEntry: any = undefined;
    if (reference && amount && debitAccountId && creditAccountId) {
      const numAmount = parseFloat(amount);
      overrideEntry = {
        reference,
        description: description || `Manual Approval for Discrepancy ${id}`,
        lines: [
          { accountId: debitAccountId, debit: numAmount, credit: 0 },
          { accountId: creditAccountId, debit: 0, credit: numAmount },
        ],
      };
    }

    const result = await resolveDiscrepancy(id, 'APPROVED', overrideEntry);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/discrepancies/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await resolveDiscrepancy(id, 'REJECTED');
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// 4. Live Agent Execution Stream (SSE)
// ==========================================

app.post('/api/pipeline/stream', async (req: Request, res: Response) => {
  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (eventType: string, data: any) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { rawText, base64Data, mimeType, directJson } = req.body;

    let extractedData: ExtractedInvoice;

    if (directJson) {
      extractedData = directJson;
      sendEvent('ingest_complete', {
        source: 'manual_json',
        data: extractedData,
        mathIntegrityVerified: true,
      });
    } else {
      sendEvent('ingest_start', {
        message: 'Parsing document with Gemini 2.5 Flash into strict accounting schema...',
      });

      const ingestRes = await ingestAgent.ingestInvoice({
        rawText,
        base64Data,
        mimeType,
      });

      extractedData = ingestRes.data;

      sendEvent('ingest_complete', {
        success: ingestRes.success,
        data: extractedData,
        mathIntegrityVerified: ingestRes.mathIntegrityVerified,
        variance: ingestRes.variance,
        warnings: ingestRes.warnings,
      });
    }

    // Step 2: Stream ReAct Reasoning & Tool Calls
    sendEvent('react_start', {
      message: 'Launching Gemini 2.5 Pro ReAct Audit loop with MCP tools...',
      invoiceNumber: extractedData.invoiceNumber,
      vendor: extractedData.vendor,
    });

    const orchestrationResult = await orchestrator.processInvoice(
      extractedData,
      (step: ReActStep) => {
        sendEvent('react_step', step);
      }
    );

    // Fetch updated ledger balances
    const latestAccounts = await fetchLedgerAccounts();

    sendEvent('audit_complete', {
      orchestration: orchestrationResult,
      updatedAccounts: latestAccounts.accounts,
    });

    res.write('event: done\ndata: {"completed": true}\n\n');
    res.end();
  } catch (error: any) {
    sendEvent('error', { message: error.message || 'Pipeline processing error' });
    res.end();
  }
});

// Non-streaming fallback endpoint
app.post('/api/pipeline/process-invoice', async (req: Request, res: Response) => {
  try {
    const { rawText, base64Data, mimeType, directJson } = req.body;
    let extractedData: ExtractedInvoice;

    if (directJson) {
      extractedData = directJson;
    } else {
      const ingestRes = await ingestAgent.ingestInvoice({ rawText, base64Data, mimeType });
      extractedData = ingestRes.data;
    }

    const orchestration = await orchestrator.processInvoice(extractedData);
    const latestAccounts = await fetchLedgerAccounts();

    res.json({
      success: true,
      data: extractedData,
      orchestration,
      accounts: latestAccounts.accounts,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Direct Tool Endpoints
app.post('/api/ledger/verify-tax', async (req: Request, res: Response) => {
  try {
    const { taxId, invoiceAmount, calculatedTax } = req.body;
    const result = await verifyTaxCompliance({ taxId, invoiceAmount, calculatedTax });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ledger/post-entry', async (req: Request, res: Response) => {
  try {
    const { reference, description, lines } = req.body;
    const result = await postJournalEntry({ reference, description, lines });
    if (!result.success && !result.balanceVerified) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/discrepancies/flag', async (req: Request, res: Response) => {
  try {
    const { reason, varianceAmount, recommendedAction } = req.body;
    const result = await flagDiscrepancyForReview({ reason, varianceAmount, recommendedAction });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fallback route for SPA
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ==========================================
// Start Server
// ==========================================

export async function startServer(): Promise<void> {
  const dbConnected = await healthCheck();
  if (dbConnected) {
    console.log('PostgreSQL database connected.');
    await initializeDatabase();
  } else {
    console.log('PostgreSQL is offline. AgentLedger running with in-memory double-entry ledger.');
  }

  app.listen(PORT, () => {
    console.log(`AgentLedger UI & API Server running on http://localhost:${PORT}`);
    console.log(`- Dashboard: http://localhost:${PORT}`);
    console.log(`- Live Agent SSE Stream: http://localhost:${PORT}/api/pipeline/stream`);
  });
}

// Start if executed directly
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
  });
}

export default app;
