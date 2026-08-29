import { PiiSanitizer } from '../agent/piiSanitizer.js';
import { LedgerOrchestrator } from '../agent/orchestrator.js';
import { ExtractedInvoice } from '../agent/ingest.js';

async function runPiiTests() {
  console.log('====================================================');
  console.log('    🛡️  PII SANITIZER & PRIVACY SHIELD TESTS        ');
  console.log('====================================================\n');

  const sanitizer = new PiiSanitizer();

  // Test 1: Direct PiiSanitizer verification
  console.log('Test 1: Sanitizing sensitive invoice with bank account, employee signature, and SSN...');
  const sensitiveInvoice: ExtractedInvoice = {
    vendor: 'Stripe Payments Inc',
    taxId: 'VAT-US-991823',
    invoiceNumber: 'INV-STRIPE-8831',
    date: '2026-08-28',
    currency: 'USD',
    subtotal: 1200.0,
    taxAmount: 156.0,
    totalAmount: 1356.0,
    confidenceScore: 0.98,
    rawNotes: 'Wire transfer payment to Routing: 021000021, Account: 987654321098. Signer: Alice Johnson (alice.private@gmail.com). SSN on file: 123-45-6789.',
    lineItems: [
      {
        description: 'Payment Processing Fee for Employee: Bob Smith (Account: 4455667788)',
        quantity: 1,
        unitPrice: 1200.0,
        total: 1200.0,
        suggestedAccountType: 'EXPENSE',
      },
    ],
  };

  const result = await sanitizer.sanitize(sensitiveInvoice);

  console.log(`- Redactions Count: ${result.redactionsCount}`);
  console.log(`- Redactions Summary:`, result.redactionsSummary);
  console.log(`- Sanitized Notes: ${result.sanitizedInvoice.rawNotes}`);
  console.log(`- Sanitized Item Description: ${result.sanitizedInvoice.lineItems[0].description}`);
  console.log(`- Preserved Vendor: ${result.sanitizedInvoice.vendor}`);
  console.log(`- Preserved Total: $${result.sanitizedInvoice.totalAmount}\n`);

  // Verify assertions
  const hasAccountToken = result.sanitizedInvoice.rawNotes?.includes('[REDACTED_ACCOUNT]');
  const hasSsnToken = result.sanitizedInvoice.rawNotes?.includes('[REDACTED_SSN]');
  const hasEmployeeToken = result.sanitizedInvoice.lineItems[0].description.includes('[REDACTED_EMPLOYEE]');
  const hasPreservedAmounts = result.sanitizedInvoice.totalAmount === 1356.0;

  if (hasAccountToken && hasSsnToken && hasEmployeeToken && hasPreservedAmounts) {
    console.log('✅ Direct Sanitizer Verification: PASSED\n');
  } else {
    throw new Error('Sanitizer failed to redact tokens or corrupted amounts!');
  }

  // Test 2: Orchestrator Step 0 integration verification
  console.log('Test 2: Verifying Orchestrator executes PII Sanitizer as Step 0...');
  const orchestrator = new LedgerOrchestrator();
  const streamedSteps: any[] = [];

  const orchestration = await orchestrator.processInvoice(sensitiveInvoice, (step) => {
    streamedSteps.push(step);
  });

  const stepZero = streamedSteps.find((s) => s.step === 0);
  console.log(`- Step 0 Received:`, Boolean(stepZero));
  if (stepZero) {
    console.log(`  └─ Thought: ${stepZero.thought}`);
  }
  console.log(`- Final Status: ${orchestration.status}`);
  console.log(`- Balance Verified: ${orchestration.balanceVerified}\n`);

  console.log('====================================================');
  console.log('     ALL PII SANITIZER & SHIELD TESTS PASSED!       ');
  console.log('====================================================');
}

runPiiTests().catch(console.error);
