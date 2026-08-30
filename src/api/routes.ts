import { Router, Request, Response } from 'express';
import { IngestAgent } from '../agent/ingest.js';
import { LedgerOrchestrator } from '../agent/orchestrator.js';
import {
  fetchLedgerAccounts,
  verifyTaxCompliance,
  postJournalEntry,
  flagDiscrepancyForReview,
} from '../mcp/ledgerTools.js';
import { query, healthCheck } from '../db/index.js';

export const apiRouter = Router();

const ingestAgent = new IngestAgent();
const orchestrator = new LedgerOrchestrator();

// Health Check
apiRouter.get('/health', async (_req: Request, res: Response) => {
  const dbAlive = await healthCheck();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    databaseConnected: dbAlive,
  });
});

// Ingest Endpoint (gemini-2.5-flash) - Parses base64 PDF/image or rawText into strict JSON
apiRouter.post('/ingest', async (req: Request, res: Response) => {
  try {
    const { rawText, base64Data, mimeType, fileName } = req.body;
    const result = await ingestAgent.ingestInvoice({
      rawText,
      base64Data,
      mimeType,
      fileName,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Orchestrate Endpoint (gemini-2.5-pro) - Runs ReAct loop with MCP tools
apiRouter.post('/orchestrate', async (req: Request, res: Response) => {
  try {
    const invoice = req.body;
    const result = await orchestrator.processInvoice(invoice);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// End-to-End Pipeline: Ingest + ReAct Audit & Post
apiRouter.post('/pipeline/process-invoice', async (req: Request, res: Response) => {
  try {
    const { rawText, base64Data, mimeType, fileName } = req.body;
    
    // Step 1: Ingest
    const ingestResult = await ingestAgent.ingestInvoice({
      rawText,
      base64Data,
      mimeType,
      fileName,
    });

    // Step 2: Orchestrate ReAct Audit
    const orchestrationResult = await orchestrator.processInvoice(ingestResult.data);

    res.json({
      success: true,
      ingest: ingestResult,
      orchestration: orchestrationResult,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Direct Tool Proxy Endpoints
apiRouter.get('/ledger/accounts', async (req: Request, res: Response) => {
  try {
    const accountType = req.query.type as string | undefined;
    const result = await fetchLedgerAccounts({ accountType });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/ledger/verify-tax', async (req: Request, res: Response) => {
  try {
    const { taxId, invoiceAmount, calculatedTax } = req.body;
    const result = await verifyTaxCompliance({ taxId, invoiceAmount, calculatedTax });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

apiRouter.post('/ledger/post-entry', async (req: Request, res: Response) => {
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

apiRouter.get('/discrepancies', async (_req: Request, res: Response) => {
  try {
    const result = await query('SELECT * FROM discrepancies ORDER BY created_at DESC');
    res.json({ success: true, discrepancies: result.rows });
  } catch (error: any) {
    res.json({ success: true, discrepancies: [] });
  }
});

apiRouter.post('/discrepancies/flag', async (req: Request, res: Response) => {
  try {
    const { reason, varianceAmount, recommendedAction } = req.body;
    const result = await flagDiscrepancyForReview({ reason, varianceAmount, recommendedAction });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
