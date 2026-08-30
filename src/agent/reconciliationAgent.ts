import { GoogleGenAI } from '@google/genai';
import { RECONCILIATION_SYSTEM_PROMPT } from './prompts.js';
import { ExtractedInvoiceData } from './extractionAgent.js';
import {
  geminiLedgerTools,
  handleLedgerToolCall,
  fetchLedgerAccounts,
  verifyTaxCompliance,
  postJournalEntry,
  flagDiscrepancyForReview,
} from '../mcp/ledgerTools.js';

export interface ReconciliationResult {
  status: 'POSTED' | 'FLAGGED_FOR_REVIEW' | 'REJECTED';
  reference: string;
  confidenceScore: number;
  taxCompliance?: any;
  journalEntry?: any;
  discrepancy?: any;
  reasoning: string[];
}

export class ReconciliationAgent {
  private ai: GoogleGenAI;
  private modelName = 'gemini-2.5-pro';

  constructor(apiKey?: string) {
    this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || '' });
  }

  /**
   * Process and reconcile an extracted invoice with zero-trust accounting constraints.
   */
  async reconcileInvoice(invoice: ExtractedInvoiceData): Promise<ReconciliationResult> {
    const reasoning: string[] = [];
    reasoning.push(`Initiating reconciliation for reference: ${invoice.reference}, Vendor: ${invoice.vendorName}`);

    // Constraint 1: Low confidence (< 0.85) triggers discrepancy review
    if (invoice.confidenceScore < 0.85) {
      reasoning.push(`Low confidence score (${invoice.confidenceScore.toFixed(2)} < 0.85). Triggering discrepancy review.`);
      const disc = await flagDiscrepancyForReview({
        reason: `Low confidence extraction (${(invoice.confidenceScore * 100).toFixed(1)}%) for ${invoice.reference}. Needs human audit.`,
        varianceAmount: 0,
        recommendedAction: 'Manually inspect document scan and verify line items before approval.',
      });

      return {
        status: 'FLAGGED_FOR_REVIEW',
        reference: invoice.reference,
        confidenceScore: invoice.confidenceScore,
        discrepancy: disc,
        reasoning,
      };
    }

    // Step 1: Verify Tax Compliance
    reasoning.push(`Checking tax compliance for Tax ID: ${invoice.taxId}`);
    const taxCheck = await verifyTaxCompliance({
      taxId: invoice.taxId,
      invoiceAmount: invoice.subtotal,
      calculatedTax: invoice.taxAmount,
    });

    if (!taxCheck.compliant) {
      reasoning.push(`Tax compliance check failed. Variance: ${taxCheck.taxVariance.toFixed(2)}`);
      const disc = await flagDiscrepancyForReview({
        reason: `Tax compliance mismatch for invoice ${invoice.reference}: ${taxCheck.details.notes}`,
        varianceAmount: taxCheck.taxVariance,
        recommendedAction: 'Verify vendor tax certificate and re-calculate tax line.',
      });

      return {
        status: 'FLAGGED_FOR_REVIEW',
        reference: invoice.reference,
        confidenceScore: invoice.confidenceScore,
        taxCompliance: taxCheck,
        discrepancy: disc,
        reasoning,
      };
    }

    // Step 2: Fetch Accounts Chart
    reasoning.push('Fetching ledger accounts to map debits and credits.');
    const accountsResult = await fetchLedgerAccounts();
    const accounts = accountsResult.accounts || [];

    const expenseAcc = accounts.find((a: any) => a.id === 'acc_expense') || { id: 'acc_expense' };
    const taxAcc = accounts.find((a: any) => a.id === 'acc_tax_payable') || { id: 'acc_tax_payable' };
    const apAcc = accounts.find((a: any) => a.id === 'acc_ap') || { id: 'acc_ap' };

    // Step 3: Construct balanced double-entry lines
    const lines = [
      {
        accountId: expenseAcc.id,
        debit: Number(invoice.subtotal.toFixed(2)),
        credit: 0,
      },
      {
        accountId: taxAcc.id,
        debit: Number(invoice.taxAmount.toFixed(2)),
        credit: 0,
      },
      {
        accountId: apAcc.id,
        debit: 0,
        credit: Number(invoice.totalAmount.toFixed(2)),
      },
    ];

    const totalDebits = lines.reduce((acc, l) => acc + l.debit, 0);
    const totalCredits = lines.reduce((acc, l) => acc + l.credit, 0);
    const balanceVariance = Math.abs(totalDebits - totalCredits);

    reasoning.push(
      `Verifying balance: Total Debits = ${totalDebits.toFixed(2)}, Total Credits = ${totalCredits.toFixed(2)}, Variance = ${balanceVariance.toFixed(4)}`
    );

    // Constraint 2: Strict Double-Entry Rule abs(sum(debits) - sum(credits)) < 0.001
    if (balanceVariance >= 0.001) {
      reasoning.push(`Unbalanced transaction detected (Variance: ${balanceVariance.toFixed(4)}). Rejecting entry.`);
      const disc = await flagDiscrepancyForReview({
        reason: `Unbalanced transaction for ${invoice.reference}: Debits (${totalDebits}) != Credits (${totalCredits})`,
        varianceAmount: balanceVariance,
        recommendedAction: 'Recalculate invoice item subtotals and vendor invoice line totals.',
      });

      return {
        status: 'REJECTED',
        reference: invoice.reference,
        confidenceScore: invoice.confidenceScore,
        taxCompliance: taxCheck,
        discrepancy: disc,
        reasoning,
      };
    }

    // Step 4: Post balanced Journal Entry to PostgreSQL
    reasoning.push('Posting verified double-entry journal entry to PostgreSQL ledger.');
    const postResult = await postJournalEntry({
      reference: invoice.reference,
      description: `Invoice from ${invoice.vendorName} (Ref: ${invoice.reference})`,
      lines,
    });

    if (!postResult.success) {
      reasoning.push(`Failed to post journal entry: ${postResult.error}`);
      return {
        status: 'REJECTED',
        reference: invoice.reference,
        confidenceScore: invoice.confidenceScore,
        reasoning,
      };
    }

    reasoning.push(`Journal entry posted successfully. Verified double-entry balanced.`);

    return {
      status: 'POSTED',
      reference: invoice.reference,
      confidenceScore: invoice.confidenceScore,
      taxCompliance: taxCheck,
      journalEntry: postResult,
      reasoning,
    };
  }
}
