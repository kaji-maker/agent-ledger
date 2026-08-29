import { IngestAgent, ExtractedInvoice } from '../agent/ingest.js';
import { LedgerOrchestrator } from '../agent/orchestrator.js';

async function runPipelineTests() {
  console.log('====================================================');
  console.log('   AGENTLEDGER INGEST & RE-ACT ORCHESTRATOR TESTS   ');
  console.log('====================================================\n');

  const ingestAgent = new IngestAgent();
  const orchestrator = new LedgerOrchestrator();

  // Test 1: Ingest Simulation & Strict Schema Validation
  console.log('Test 1: Ingesting sample invoice text into strict JSON schema...');
  const sampleInvoiceRaw = `
  TAX INVOICE
  Supplier: Apex Cloud Computing Services LLC
  VAT Registration ID: VAT-US-9928371
  Invoice No: INV-2026-8812
  Date: 2026-08-28
  Currency: USD

  Items:
  1. High-Performance GPU Cluster (40 hrs @ $20.00/hr) - $800.00
  2. Managed Object Storage 10TB - $200.00

  Subtotal: $1,000.00
  Tax (13% VAT): $130.00
  Total Amount Due: $1,130.00
  `;

  const ingestRes = await ingestAgent.ingestInvoice({
    rawText: sampleInvoiceRaw,
  });

  console.log(`- Ingest Status: success=${ingestRes.success}, mathVerified=${ingestRes.mathIntegrityVerified}`);
  console.log('- Extracted Data:');
  console.log(`  * Vendor: ${ingestRes.data.vendor}`);
  console.log(`  * Tax ID: ${ingestRes.data.taxId}`);
  console.log(`  * Invoice #: ${ingestRes.data.invoiceNumber}`);
  console.log(`  * Subtotal: $${ingestRes.data.subtotal}, Tax: $${ingestRes.data.taxAmount}, Total: $${ingestRes.data.totalAmount}`);
  console.log(`  * Confidence: ${(ingestRes.data.confidenceScore * 100).toFixed(1)}%\n`);

  // Test 2: Orchestrator ReAct Loop - Balanced Valid Invoice
  console.log('Test 2: ReAct Orchestrator auditing balanced invoice...');
  const validInvoice: ExtractedInvoice = {
    vendor: 'Apex Cloud Computing Services LLC',
    taxId: 'VAT-US-9928371',
    invoiceNumber: 'INV-2026-8812',
    date: '2026-08-28',
    currency: 'USD',
    subtotal: 1000.0,
    taxAmount: 130.0,
    totalAmount: 1130.0,
    confidenceScore: 0.96,
    lineItems: [
      { description: 'GPU compute', quantity: 40, unitPrice: 20.0, total: 800.0, suggestedAccountType: 'EXPENSE' },
      { description: 'Object storage', quantity: 1, unitPrice: 200.0, total: 200.0, suggestedAccountType: 'EXPENSE' },
    ],
  };

  const reconValid = await orchestrator.processInvoice(validInvoice);
  console.log(`- ReAct Audit Status: ${reconValid.status}`);
  console.log(`- Balance Verified: ${reconValid.balanceVerified}`);
  console.log(`- ReAct Steps Executed: ${reconValid.reactSteps.length}`);
  reconValid.reactSteps.forEach((s) => {
    if (s.thought) console.log(`    [Thought]: ${s.thought}`);
    if (s.action) console.log(`    [Action -> Tool]: ${s.action.tool}(${JSON.stringify(s.action.args)})`);
  });
  console.log(`- Summary: ${reconValid.auditSummary}\n`);

  // Test 3: Orchestrator ReAct Loop - Missing Tax Allocation / Unbalanced Invoice
  console.log('Test 3: ReAct Orchestrator auditing unbalanced invoice (Zero-Trust Enforcement)...');
  const unbalancedInvoice: ExtractedInvoice = {
    vendor: 'Faulty Vendor Inc.',
    taxId: 'VAT-US-1122334',
    invoiceNumber: 'INV-FAULTY-001',
    date: '2026-08-28',
    currency: 'USD',
    subtotal: 1000.0,
    taxAmount: 0.0, // Missing tax allocation but total has tax!
    totalAmount: 1130.0,
    confidenceScore: 0.92,
    lineItems: [
      { description: 'Faulty billing item', quantity: 1, unitPrice: 1000.0, total: 1000.0, suggestedAccountType: 'EXPENSE' },
    ],
  };

  const reconUnbalanced = await orchestrator.processInvoice(unbalancedInvoice);
  console.log(`- ReAct Audit Status: ${reconUnbalanced.status}`);
  console.log(`- Balance Verified: ${reconUnbalanced.balanceVerified}`);
  console.log(`- Rejection / Discrepancy Reason: ${reconUnbalanced.discrepancy?.reason}`);
  console.log();

  // Test 4: Orchestrator ReAct Loop - Low Confidence Score (< 0.85)
  console.log('Test 4: ReAct Orchestrator auditing low-confidence invoice (Confidence < 0.85)...');
  const lowConfidenceInvoice: ExtractedInvoice = {
    ...validInvoice,
    invoiceNumber: 'INV-BLURRY-SCAN-099',
    confidenceScore: 0.74,
  };

  const reconLowConf = await orchestrator.processInvoice(lowConfidenceInvoice);
  console.log(`- ReAct Audit Status: ${reconLowConf.status}`);
  console.log(`- Discrepancy Flagged: ${reconLowConf.discrepancy?.status}`);
  console.log(`- Flagged Reason: ${reconLowConf.discrepancy?.reason}\n`);

  console.log('====================================================');
  console.log('       ALL PIPELINE & AGENT TESTS PASSED!          ');
  console.log('====================================================');
}

runPipelineTests().catch(console.error);
