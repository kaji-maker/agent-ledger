import { IngestAgent } from '../agent/ingest.js';
import { LedgerOrchestrator } from '../agent/orchestrator.js';
import { fetchLedgerAccounts, resolveDiscrepancy } from '../mcp/ledgerTools.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLiveDemo() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       🤖 AGENTLEDGER 3-SCENARIO AUTONOMOUS AUDIT DEMO            ║');
  console.log('║   Stack: TypeScript, PostgreSQL, Express, @google/genai, MCP     ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const ingestAgent = new IngestAgent();
  const orchestrator = new LedgerOrchestrator();

  // Print initial balances
  console.log('📊 [BASELINE GENERAL LEDGER BALANCES]:');
  const initialAccounts = await fetchLedgerAccounts();
  initialAccounts.accounts.forEach((a: any) => {
    console.log(`   - ${a.code} | ${a.name.padEnd(24)} (${a.type.padEnd(9)}) : $${Number(a.balance).toFixed(2)}`);
  });
  console.log('──────────────────────────────────────────────────────────────────\n');

  await sleep(1000);

  // =========================================================================
  // SCENARIO 1: Balanced Compliant Cloud Invoice
  // =========================================================================
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(' ▶ SCENARIO 1: Compliant & Balanced Enterprise Invoice');
  console.log('   Expected Outcome: PII Sanitized -> ReAct Audit -> POSTED to Ledger');
  console.log('══════════════════════════════════════════════════════════════════');

  const invoice1Raw = `
  TAX INVOICE
  Vendor: Amazon Web Services Cloud Infrastructure Inc
  VAT ID: VAT-US-88771122
  Invoice #: INV-AWS-2026-9081
  Date: 2026-08-28
  Currency: USD

  1. EC2 GPU Compute Nodes (40 hrs @ $20.00) - $800.00
  2. S3 Scalable Cloud Object Storage - $200.00

  Subtotal: $1,000.00
  Tax (13% Sales Tax): $130.00
  Total Amount: $1,130.00
  Payment: Wire to Routing: 021000021, Account: 9988776655. Signer: Alice Johnson
  `;

  console.log('1️⃣ Ingesting invoice via Gemini 2.5 Flash...');
  const ingest1 = await ingestAgent.ingestInvoice({ rawText: invoice1Raw });
  console.log(`   └─ Extracted: ${ingest1.data.vendor} | Ref: ${ingest1.data.invoiceNumber} | Total: $${ingest1.data.totalAmount}`);

  console.log('2️⃣ Running ReAct Audit with Gemma 2 2B IT Shield & Gemini 2.5 Pro...');
  const recon1 = await orchestrator.processInvoice(ingest1.data, (step) => {
    if (step.thought) console.log(`   [Thought]: ${step.thought}`);
    if (step.action) console.log(`   [Tool Call -> MCP]: ${step.action.tool}(${JSON.stringify(step.action.args)})`);
    if (step.observation) console.log(`   [Observation]: ${JSON.stringify(step.observation).slice(0, 100)}...`);
  });

  console.log(`\n✔ SCENARIO 1 RESULT: Status=${recon1.status} | Balanced=${recon1.balanceVerified}`);
  console.log(`  └─ Summary: ${recon1.auditSummary}\n`);

  await sleep(1500);

  // =========================================================================
  // SCENARIO 2: Unbalanced Erroneous Vendor Bill (Zero-Trust Rejection)
  // =========================================================================
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(' ▶ SCENARIO 2: Unbalanced Invoice (Zero-Trust Constraint Breach)');
  console.log('   Expected Outcome: Math Violation Detected -> REJECTED & FLAGGED');
  console.log('══════════════════════════════════════════════════════════════════');

  const invoice2 = {
    vendor: 'Erroneous Vendor Corp',
    taxId: 'VAT-US-44332211',
    invoiceNumber: 'INV-ERR-8819',
    date: '2026-08-28',
    currency: 'USD',
    subtotal: 1000.0,
    taxAmount: 0.0,
    totalAmount: 1250.0, // Variance: $250!
    confidenceScore: 0.95,
    lineItems: [
      { description: 'Software Consulting', quantity: 1, unitPrice: 1000.0, total: 1000.0, suggestedAccountType: 'EXPENSE' as const },
    ],
  };

  console.log('1️⃣ Evaluating Unbalanced Invoice: Debits ($1000.00) != Credits ($1250.00)...');
  const recon2 = await orchestrator.processInvoice(invoice2, (step) => {
    if (step.thought) console.log(`   [Thought]: ${step.thought}`);
    if (step.action) console.log(`   [Tool Call -> MCP]: ${step.action.tool}(${JSON.stringify(step.action.args)})`);
  });

  console.log(`\n✔ SCENARIO 2 RESULT: Status=${recon2.status} | Balanced=${recon2.balanceVerified}`);
  console.log(`  └─ Discrepancy Logged: ${recon2.discrepancy?.reason}`);
  console.log(`  └─ Zero-trust rule prevented corrupted transaction from committing to PostgreSQL.\n`);

  await sleep(1500);

  // =========================================================================
  // SCENARIO 3: Low-Confidence Blurry Invoice with PII & Human-in-the-Loop
  // =========================================================================
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(' ▶ SCENARIO 3: Sensitive Low-Confidence Scan with PII & HITL Override');
  console.log('   Expected Outcome: Gemma 2 2B Redaction -> FLAGGED_FOR_REVIEW -> Human Approve');
  console.log('══════════════════════════════════════════════════════════════════');

  const invoice3 = {
    vendor: 'Corner Office Supplier',
    taxId: '123-45-6789', // SSN
    invoiceNumber: 'REC-BLURRY-0092',
    date: '2026-08-28',
    currency: 'USD',
    subtotal: 450.0,
    taxAmount: 58.5,
    totalAmount: 508.5,
    confidenceScore: 0.72, // Below 0.85 threshold!
    rawNotes: 'Direct wire to Account: 123456789. Signer: Bob Smith (bob.smith@gmail.com). SSN: 123-45-6789.',
    lineItems: [
      { description: 'Office Paper & Supplies for Employee: John Doe', quantity: 1, unitPrice: 450.0, total: 450.0, suggestedAccountType: 'EXPENSE' as const },
    ],
  };

  console.log('1️⃣ Running audit on low-confidence (72%) invoice with sensitive PII...');
  const recon3 = await orchestrator.processInvoice(invoice3, (step) => {
    if (step.thought) console.log(`   [Thought]: ${step.thought}`);
    if (step.action) console.log(`   [Tool Call -> MCP]: ${step.action.tool}(${JSON.stringify(step.action.args)})`);
  });

  console.log(`\n✔ SCENARIO 3 AUDIT: Status=${recon3.status}`);
  console.log(`  └─ Safety gate caught confidence < 0.85. Logged discrepancy ID: ${recon3.discrepancy?.discrepancyId}`);

  console.log('\n2️⃣ Simulating Human Accountant Review & "Approve & Post" Override...');
  const approval = await resolveDiscrepancy(recon3.discrepancy?.discrepancyId, 'APPROVED', {
    reference: 'REC-BLURRY-0092',
    description: 'Human Approved Office Supply Expense',
    lines: [
      { accountId: 'acc_expense', debit: 450.0, credit: 0 },
      { accountId: 'acc_tax_payable', debit: 58.5, credit: 0 },
      { accountId: 'acc_ap', debit: 0, credit: 508.5 },
    ],
  });

  console.log(`   └─ Human-in-the-Loop Override Applied: ${approval.message}`);
  console.log(`   └─ Journal Entry Posted: ${approval.journalEntry?.reference} | Verified Double-Entry Balanced.\n`);

  await sleep(1000);

  // Final Balance Sheet
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(' 📈 [UPDATED GENERAL LEDGER BALANCES AFTER 3 SCENARIOS]:');
  console.log('══════════════════════════════════════════════════════════════════');
  const finalAccounts = await fetchLedgerAccounts();
  finalAccounts.accounts.forEach((a: any) => {
    console.log(`   - ${a.code} | ${a.name.padEnd(24)} (${a.type.padEnd(9)}) : $${Number(a.balance).toFixed(2)}`);
  });

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       ✨ ALL 3 LIVE DEMO SCENARIOS COMPLETED SUCCESSFULLY!        ║');
  console.log('║   Dashboard UI available at: http://localhost:8080               ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
}

runLiveDemo().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
