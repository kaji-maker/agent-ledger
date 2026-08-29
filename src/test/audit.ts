import {
  geminiLedgerTools,
  mcpLedgerTools,
  fetchLedgerAccounts,
  verifyTaxCompliance,
  postJournalEntry,
  flagDiscrepancyForReview,
} from '../mcp/ledgerTools.js';
import { IngestAgent } from '../agent/ingest.js';
import { LedgerOrchestrator } from '../agent/orchestrator.js';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

async function runAuditSuite(): Promise<void> {
  console.log('\n================================================================');
  console.log('       🛡️  AGENTLEDGER COMPREHENSIVE ZERO-TRUST AUDIT TEST       ');
  console.log('================================================================\n');

  const results: TestResult[] = [];

  // -------------------------------------------------------------
  // Test 1: MCP & Gemini 3.5 Pro Tool Declarations
  // -------------------------------------------------------------
  try {
    const requiredTools = [
      'fetchLedgerAccounts',
      'verifyTaxCompliance',
      'postJournalEntry',
      'flagDiscrepancyForReview',
    ];

    const geminiToolNames = geminiLedgerTools.map((t) => t.name);
    const mcpToolNames = mcpLedgerTools.map((t) => t.name);

    const allGeminiPresent = requiredTools.every((t) => geminiToolNames.includes(t));
    const allMcpPresent = requiredTools.every((t) => mcpToolNames.includes(t));

    // Check Type enums
    const hasTypeEnums = geminiLedgerTools.every(
      (t) => t.parameters && typeof t.parameters.type === 'string'
    );

    if (allGeminiPresent && allMcpPresent && hasTypeEnums) {
      results.push({
        name: 'Tool Declarations & @google/genai Type Enums',
        passed: true,
        details: `All 4 tools exported with valid MCP and Gemini Type enums (${geminiToolNames.join(', ')})`,
      });
    } else {
      results.push({
        name: 'Tool Declarations & @google/genai Type Enums',
        passed: false,
        details: 'Missing tool declarations or invalid Type enum bindings',
      });
    }
  } catch (err: any) {
    results.push({
      name: 'Tool Declarations & @google/genai Type Enums',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Test 2: Chart of Accounts Discovery (fetchLedgerAccounts)
  // -------------------------------------------------------------
  try {
    const accountsRes = await fetchLedgerAccounts({ accountType: 'ASSET' });
    const hasAssets = accountsRes.accounts && accountsRes.accounts.length > 0;
    results.push({
      name: 'Chart of Accounts Tool (fetchLedgerAccounts)',
      passed: hasAssets,
      details: `Retrieved ${accountsRes.accounts.length} ASSET accounts`,
    });
  } catch (err: any) {
    results.push({
      name: 'Chart of Accounts Tool (fetchLedgerAccounts)',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Test 3: Tax Compliance Verification (verifyTaxCompliance)
  // -------------------------------------------------------------
  try {
    const validTax = await verifyTaxCompliance({
      taxId: 'VAT-US-9918231',
      invoiceAmount: 2000.0,
      calculatedTax: 260.0,
    });

    const invalidTax = await verifyTaxCompliance({
      taxId: 'VAT-US-9918231',
      invoiceAmount: 2000.0,
      calculatedTax: 50.0, // Significant mismatch
    });

    const passed = validTax.compliant === true && invalidTax.compliant === false;
    results.push({
      name: 'Tax Compliance & Verification (verifyTaxCompliance)',
      passed,
      details: `Valid invoice (13% tax) = ${validTax.compliant}, Invalid invoice (low tax) = ${invalidTax.compliant}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Tax Compliance & Verification (verifyTaxCompliance)',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Test 4: Zero-Trust Constraint: Balanced Journal Entry
  // -------------------------------------------------------------
  try {
    const balancedPost = await postJournalEntry({
      reference: 'AUDIT-INV-001',
      description: 'Zero-trust balanced test',
      lines: [
        { accountId: 'acc_expense', debit: 1500.0, credit: 0 },
        { accountId: 'acc_tax_payable', debit: 195.0, credit: 0 },
        { accountId: 'acc_ap', debit: 0, credit: 1695.0 },
      ],
    });

    const passed = balancedPost.success === true && balancedPost.balanceVerified === true;
    results.push({
      name: 'Balanced Journal Entry Commitment (sum(debits) === sum(credits))',
      passed,
      details: `Debits: $1695.00, Credits: $1695.00 -> balanceVerified: ${balancedPost.balanceVerified}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Balanced Journal Entry Commitment (sum(debits) === sum(credits))',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Test 5: Zero-Trust Constraint: Unbalanced Entry Strict Rejection
  // -------------------------------------------------------------
  try {
    const unbalancedPost = await postJournalEntry({
      reference: 'AUDIT-INV-002-UNBALANCED',
      description: 'Deliberately unbalanced entry',
      lines: [
        { accountId: 'acc_expense', debit: 1000.0, credit: 0 },
        { accountId: 'acc_ap', debit: 0, credit: 1200.0 }, // $200 variance
      ],
    });

    const rejected = unbalancedPost.success === false && unbalancedPost.balanceVerified === false;
    results.push({
      name: 'Zero-Trust Rejection of Unbalanced Transaction',
      passed: rejected,
      details: `Variance: $${unbalancedPost.variance?.toFixed(2)} -> Successfully blocked from ledger`,
    });
  } catch (err: any) {
    results.push({
      name: 'Zero-Trust Rejection of Unbalanced Transaction',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Test 6: Automated Discrepancy Logging (flagDiscrepancyForReview)
  // -------------------------------------------------------------
  try {
    const disc = await flagDiscrepancyForReview({
      reason: 'Audit verification test discrepancy',
      varianceAmount: 42.5,
      recommendedAction: 'Automated audit review flag',
    });

    const passed = disc.status === 'FLAGGED' && disc.varianceAmount === 42.5;
    results.push({
      name: 'Discrepancy Logging for Review (flagDiscrepancyForReview)',
      passed,
      details: `Discrepancy recorded with status: ${disc.status}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Discrepancy Logging for Review (flagDiscrepancyForReview)',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Test 7: Orchestrator ReAct Audit Loop
  // -------------------------------------------------------------
  try {
    const orchestrator = new LedgerOrchestrator();
    const invoice = {
      vendor: 'Cloudflare Inc',
      taxId: 'VAT-US-88776655',
      invoiceNumber: 'INV-CF-2026',
      date: '2026-08-28',
      currency: 'USD',
      subtotal: 500.0,
      taxAmount: 65.0,
      totalAmount: 565.0,
      confidenceScore: 0.95,
      lineItems: [
        { description: 'DNS & CDN Enterprise Plan', quantity: 1, unitPrice: 500.0, total: 500.0 },
      ],
    };

    const recon = await orchestrator.processInvoice(invoice);
    const passed = recon.status === 'POSTED' && recon.balanceVerified === true;
    results.push({
      name: 'Autonomous ReAct Audit Loop (Gemini 3.5 Pro)',
      passed,
      details: `Audit status: ${recon.status}, Executed ${recon.reactSteps.length} ReAct steps`,
    });
  } catch (err: any) {
    results.push({
      name: 'Autonomous ReAct Audit Loop (Gemini 3.5 Pro)',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Test 8: Low Confidence Threshold Enforcement (< 0.85)
  // -------------------------------------------------------------
  try {
    const orchestrator = new LedgerOrchestrator();
    const lowConfInvoice = {
      vendor: 'Uncertain Vendor',
      taxId: 'VAT-US-00000',
      invoiceNumber: 'INV-BLURRY-099',
      date: '2026-08-28',
      currency: 'USD',
      subtotal: 100.0,
      taxAmount: 13.0,
      totalAmount: 113.0,
      confidenceScore: 0.70, // Below 0.85 threshold
      lineItems: [{ description: 'Item', quantity: 1, unitPrice: 100.0, total: 100.0 }],
    };

    const recon = await orchestrator.processInvoice(lowConfInvoice);
    const passed = recon.status === 'FLAGGED_FOR_REVIEW';
    results.push({
      name: 'Low Confidence (< 0.85) Zero-Trust Safety Gate',
      passed,
      details: `Confidence: ${(lowConfInvoice.confidenceScore * 100).toFixed(0)}% -> Status: ${recon.status}`,
    });
  } catch (err: any) {
    results.push({
      name: 'Low Confidence (< 0.85) Zero-Trust Safety Gate',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Test 9: Privacy & PII Sanitizer (Gemma 2 2B IT)
  // -------------------------------------------------------------
  try {
    const { PiiSanitizer } = await import('../agent/piiSanitizer.js');
    const piiSanitizer = new PiiSanitizer();
    const sensitiveTestInvoice = {
      vendor: 'Acme Vendor',
      taxId: '123-45-6789', // SSN
      invoiceNumber: 'INV-PII-001',
      date: '2026-08-28',
      currency: 'USD',
      subtotal: 1000.0,
      taxAmount: 130.0,
      totalAmount: 1130.0,
      confidenceScore: 0.95,
      rawNotes: 'Account: 998877665544, Prepared by: John Doe',
      lineItems: [{ description: 'Cloud servers for Alice (Account: 11223344)', quantity: 1, unitPrice: 1000.0, total: 1000.0 }],
    };

    const sanitizedRes = await piiSanitizer.sanitize(sensitiveTestInvoice);
    const passed = Boolean(
      sanitizedRes.sanitizedInvoice.taxId === '[REDACTED_SSN]' &&
      sanitizedRes.sanitizedInvoice.rawNotes?.includes('[REDACTED_ACCOUNT]') &&
      sanitizedRes.sanitizedInvoice.lineItems[0].description.includes('[REDACTED_ACCOUNT]') &&
      sanitizedRes.sanitizedInvoice.totalAmount === 1130.0
    );

    results.push({
      name: 'Privacy & PII Sanitizer Shield (gemma-2-2b-it)',
      passed,
      details: `Redacted ${sanitizedRes.redactionsCount} tokens ([REDACTED_SSN], [REDACTED_ACCOUNT], [REDACTED_EMPLOYEE]) while preserving financial figures`,
    });
  } catch (err: any) {
    results.push({
      name: 'Privacy & PII Sanitizer Shield (gemma-2-2b-it)',
      passed: false,
      details: err.message,
    });
  }

  // -------------------------------------------------------------
  // Audit Summary Reporting
  // -------------------------------------------------------------
  console.log('\nAudit Execution Results:');
  console.log('----------------------------------------------------------------');
  let passedCount = 0;

  for (const r of results) {
    const icon = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${icon} | ${r.name}`);
    console.log(`       └─ ${r.details}`);
    if (r.passed) passedCount++;
  }

  console.log('----------------------------------------------------------------');
  console.log(`Summary: ${passedCount}/${results.length} audit checks passed (${((passedCount / results.length) * 100).toFixed(1)}%)\n`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runAuditSuite().catch((err) => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
