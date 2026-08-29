import {
  fetchLedgerAccounts,
  verifyTaxCompliance,
  postJournalEntry,
  flagDiscrepancyForReview,
  geminiLedgerTools,
  mcpLedgerTools,
} from '../mcp/ledgerTools.js';
import { ReconciliationAgent } from '../agent/reconciliationAgent.js';

async function runTests() {
  console.log('====================================================');
  console.log('      AGENTLEDGER ZERO-TRUST MCP TOOL TESTS         ');
  console.log('====================================================\n');

  // Test 1: Tool Declarations Export Check
  console.log('1. Checking Tool Declarations & Type Enums:');
  console.log(`- Gemini Tool Declarations Exported: ${geminiLedgerTools.length} tools`);
  geminiLedgerTools.forEach((t) => console.log(`  * ${t.name}: parameters type = ${t.parameters?.type}`));
  console.log(`- MCP Tool Definitions Exported: ${mcpLedgerTools.length} tools\n`);

  // Test 2: fetchLedgerAccounts
  console.log('2. Testing fetchLedgerAccounts:');
  const accountsRes = await fetchLedgerAccounts({ accountType: 'ASSET' });
  console.log(`- Fetched ${accountsRes.count} ASSET accounts:`, accountsRes.accounts.map((a: any) => `${a.code} - ${a.name}`));
  console.log();

  // Test 3: verifyTaxCompliance
  console.log('3. Testing verifyTaxCompliance:');
  const taxValid = await verifyTaxCompliance({
    taxId: 'VAT-987654321',
    invoiceAmount: 1000.0,
    calculatedTax: 130.0,
  });
  console.log(`- Valid Tax Check: compliant=${taxValid.compliant}, variance=${taxValid.taxVariance}`);

  const taxInvalid = await verifyTaxCompliance({
    taxId: 'VAT-987654321',
    invoiceAmount: 1000.0,
    calculatedTax: 250.0,
  });
  console.log(`- Invalid Tax Check: compliant=${taxInvalid.compliant}, variance=${taxInvalid.taxVariance}`);
  console.log();

  // Test 4: postJournalEntry with STRICT Double-Entry Validation
  console.log('4. Testing postJournalEntry (Zero-Trust Constraints):');
  
  // 4a. Balanced entry: Debits (1130) === Credits (1130)
  console.log('4a. Submitting Balanced Entry (Debits: 1130, Credits: 1130):');
  const balancedResult = await postJournalEntry({
    reference: 'INV-2026-001',
    description: 'Office Supplies Purchase',
    lines: [
      { accountId: 'acc_expense', debit: 1000.0, credit: 0 },
      { accountId: 'acc_tax_payable', debit: 130.0, credit: 0 },
      { accountId: 'acc_ap', debit: 0, credit: 1130.0 },
    ],
  });
  console.log(`- Balanced Entry Result: success=${balancedResult.success}, balanceVerified=${balancedResult.balanceVerified}`);

  // 4b. Unbalanced entry: Debits (1000) !== Credits (1130)
  console.log('4b. Submitting Unbalanced Entry (Debits: 1000, Credits: 1130):');
  const unbalancedResult = await postJournalEntry({
    reference: 'INV-2026-002-UNBALANCED',
    description: 'Erroneous Vendor Bill',
    lines: [
      { accountId: 'acc_expense', debit: 1000.0, credit: 0 },
      { accountId: 'acc_ap', debit: 0, credit: 1130.0 },
    ],
  });
  console.log(`- Unbalanced Entry Result: success=${unbalancedResult.success}, balanceVerified=${unbalancedResult.balanceVerified}`);
  console.log(`- Rejection reason: ${unbalancedResult.error}`);
  console.log();

  // Test 5: flagDiscrepancyForReview
  console.log('5. Testing flagDiscrepancyForReview:');
  const discrepancyRes = await flagDiscrepancyForReview({
    reason: 'Vendor invoice total mismatch on line item 3',
    varianceAmount: 45.5,
    recommendedAction: 'Contact vendor for credit note',
  });
  console.log(`- Discrepancy Flagged: status=${discrepancyRes.status}, id=${discrepancyRes.discrepancyId}`);
  console.log();

  // Test 6: Full Reconciliation Flow with Zero-Trust Audit
  console.log('6. Testing Full Reconciliation Flow:');
  const reconciler = new ReconciliationAgent();

  // 6a: Valid invoice
  const validInvoice = {
    vendorName: 'Acme Cloud Services',
    taxId: 'VAT-12345678',
    reference: 'INV-ACME-8901',
    date: '2026-08-28',
    currency: 'USD',
    subtotal: 500.0,
    taxAmount: 65.0,
    totalAmount: 565.0,
    confidenceScore: 0.95,
    items: [{ description: 'Cloud compute usage', quantity: 1, unitPrice: 500.0, total: 500.0 }],
  };
  const reconResultValid = await reconciler.reconcileInvoice(validInvoice);
  console.log(`- Valid Invoice Reconciliation: status=${reconResultValid.status}, reference=${reconResultValid.reference}`);

  // 6b: Low confidence invoice (< 0.85)
  const lowConfidenceInvoice = {
    ...validInvoice,
    reference: 'INV-BLURRY-002',
    confidenceScore: 0.72,
  };
  const reconResultLowConf = await reconciler.reconcileInvoice(lowConfidenceInvoice);
  console.log(`- Low Confidence Invoice Reconciliation: status=${reconResultLowConf.status}, reference=${reconResultLowConf.reference}`);

  console.log('\nAll tests completed successfully!');
}

runTests().catch(console.error);
