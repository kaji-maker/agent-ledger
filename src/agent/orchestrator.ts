import { GoogleGenAI, Content } from '@google/genai';
import dotenv from 'dotenv';
import { ExtractedInvoice } from './ingest.js';
import { PiiSanitizer } from './piiSanitizer.js';
import {
  geminiLedgerTools,
  handleLedgerToolCall,
  fetchLedgerAccounts,
  verifyTaxCompliance,
  postJournalEntry,
  flagDiscrepancyForReview,
} from '../mcp/ledgerTools.js';

dotenv.config();

// ==========================================
// Orchestrator Types & Interfaces
// ==========================================

export interface ReActStep {
  step: number;
  thought?: string;
  action?: {
    tool: string;
    args: any;
  };
  observation?: any;
  timestamp?: string;
}

export interface OrchestrationResult {
  status: 'POSTED' | 'FLAGGED_FOR_REVIEW' | 'REJECTED';
  reference: string;
  vendor: string;
  totalAmount: number;
  balanceVerified: boolean;
  journalEntry?: any;
  discrepancy?: any;
  reactSteps: ReActStep[];
  auditSummary: string;
}

export type StepCallback = (step: ReActStep) => void;

// ==========================================
// ReAct Prompt & System Instruction
// ==========================================

const ORCHESTRATOR_SYSTEM_INSTRUCTION = `
You are the Senior Ledger Reconciliation & Audit Orchestrator for AgentLedger, powered by Gemini 3.5 Pro.
Your task is to operate in a strict ReAct (Reason + Act) loop to audit extracted invoice data and post double-entry journal entries.

Strict Zero-Trust & Accounting Rules:
1. Double-Entry Accounting Rule: sum(debits) MUST equal sum(credits) with precision < 0.001.
2. Step 1 (Discovery): Query 'fetchLedgerAccounts' to inspect available chart of accounts (e.g. Operating Expenses, Inventory, Tax Payable, Accounts Payable, Cash).
3. Step 2 (Tax Compliance): Call 'verifyTaxCompliance' with vendor taxId, subtotal, and taxAmount.
4. Step 3 (Allocation & Mismatch Detection):
   - Map line items to proper account IDs (e.g. acc_expense for services/expenses, acc_inventory for physical goods).
   - Map tax to sales/VAT tax account (e.g. acc_tax_payable or input tax).
   - Map total payable to accounts payable (acc_ap) or cash (acc_cash).
   - Detect any missing tax allocations or line item mismatches.
5. Step 4 (Validation & Action):
   - If confidenceScore < 0.85, tax is non-compliant, or debits/credits do not balance (variance > 0), you MUST call 'flagDiscrepancyForReview' and DO NOT post an unbalanced transaction.
   - If perfectly balanced and verified, call 'postJournalEntry'.
`;

// ==========================================
// Orchestrator Implementation
// ==========================================

export class LedgerOrchestrator {
  private ai: GoogleGenAI;
  private piiSanitizer: PiiSanitizer;
  public readonly model = 'gemini-3.5-pro';
  private maxIterations = 6;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || '';
    this.ai = new GoogleGenAI({ apiKey: key });
    this.piiSanitizer = new PiiSanitizer(key);
  }

  /**
   * Execute full ReAct loop on extracted invoice data with real-time step streaming.
   * Step 1: Sanitizes sensitive PII (Bank numbers, employee identities, SSNs) via Gemma 2 2B IT.
   * Step 2: Audits and posts balanced double-entry transaction via Gemini 3.5 Pro.
   */
  async processInvoice(
    invoice: ExtractedInvoice,
    onStep?: StepCallback
  ): Promise<OrchestrationResult> {
    const reactSteps: ReActStep[] = [];

    // Step 0: PII & Sensitive Identity Sanitization via Gemma 2 2B IT
    const sanitization = await this.piiSanitizer.sanitize(invoice);
    const sanitizedInvoice = sanitization.sanitizedInvoice;

    if (sanitization.redactionsCount > 0 || sanitization.sanitizedByModel) {
      const step: ReActStep = {
        step: 0,
        thought: `🛡️ [Privacy & PII Sanitizer / Gemma 2 2B IT]: Redacted ${sanitization.redactionsCount} sensitive token(s): ${sanitization.redactionsSummary.join('; ')}`,
        timestamp: new Date().toISOString(),
      };
      reactSteps.push(step);
      if (onStep) onStep(step);
    }

    const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

    // If API key is available, run autonomous Gemini 3.5 Pro ReAct loop
    if (hasApiKey) {
      try {
        return await this.runGeminiReActLoop(sanitizedInvoice, reactSteps, onStep);
      } catch (err: any) {
        console.warn(
          `Gemini ReAct loop error: ${err.message}. Falling back to deterministic zero-trust engine.`
        );
      }
    }

    // Deterministic Zero-Trust ReAct Orchestration Engine
    return await this.runDeterministicReActEngine(sanitizedInvoice, reactSteps, onStep);
  }

  /**
   * Autonomous ReAct loop using Gemini 3.5 Pro function calling.
   */
  private async runGeminiReActLoop(
    invoice: ExtractedInvoice,
    reactSteps: ReActStep[],
    onStep?: StepCallback
  ): Promise<OrchestrationResult> {
    const initialPrompt = `
Audit and reconcile the following extracted invoice for posting:
${JSON.stringify(invoice, null, 2)}

Begin the ReAct audit process:
1. Discover ledger accounts
2. Check tax compliance
3. Allocate debits and credits
4. Verify balance and post or flag discrepancy.
`;

    const contents: Content[] = [
      {
        role: 'user',
        parts: [{ text: initialPrompt }],
      },
    ];

    let journalEntryResult: any = null;
    let discrepancyResult: any = null;
    let finalSummary = '';

    for (let i = 0; i < this.maxIterations; i++) {
      const stepIndex = i + 1;
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: ORCHESTRATOR_SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: geminiLedgerTools }],
          temperature: 0.1,
        },
      });

      const candidate = response.candidates?.[0];
      if (!candidate || !candidate.content) {
        break;
      }

      const modelParts = candidate.content.parts || [];
      const functionCalls = response.functionCalls || [];

      // Extract model thought / reasoning
      const thoughtText = modelParts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join(' ');

      if (thoughtText) {
        finalSummary += thoughtText + '\n';
      }

      // If no function calls, the model finished its reasoning
      if (functionCalls.length === 0) {
        const step: ReActStep = {
          step: stepIndex,
          thought: thoughtText || 'Completed reconciliation audit reasoning.',
          timestamp: new Date().toISOString(),
        };
        reactSteps.push(step);
        if (onStep) onStep(step);
        break;
      }

      // Record model response to conversation history
      contents.push({
        role: 'model',
        parts: modelParts,
      });

      // Execute each tool call requested by Gemini
      const toolResponseParts: any[] = [];
      for (const fnCall of functionCalls) {
        const name = fnCall.name || '';
        const args = fnCall.args || {};
        if (!name) continue;

        let observation: any;

        try {
          observation = await handleLedgerToolCall(name, args);
          if (name === 'postJournalEntry') {
            journalEntryResult = observation;
          } else if (name === 'flagDiscrepancyForReview') {
            discrepancyResult = observation;
          }
        } catch (callErr: any) {
          observation = { success: false, error: callErr.message };
        }

        const step: ReActStep = {
          step: stepIndex,
          thought: thoughtText,
          action: { tool: name, args },
          observation,
          timestamp: new Date().toISOString(),
        };

        reactSteps.push(step);
        if (onStep) onStep(step);

        toolResponseParts.push({
          functionResponse: {
            name,
            response: observation,
          },
        });
      }

      // Feed observations back into the ReAct conversation
      contents.push({
        role: 'user',
        parts: toolResponseParts,
      });
    }

    const isPosted = journalEntryResult?.success && journalEntryResult?.balanceVerified;
    const isFlagged = Boolean(discrepancyResult);

    return {
      status: isPosted ? 'POSTED' : isFlagged ? 'FLAGGED_FOR_REVIEW' : 'REJECTED',
      reference: invoice.invoiceNumber,
      vendor: invoice.vendor,
      totalAmount: invoice.totalAmount,
      balanceVerified: isPosted,
      journalEntry: journalEntryResult,
      discrepancy: discrepancyResult,
      reactSteps,
      auditSummary: finalSummary.trim() || 'ReAct reconciliation cycle executed.',
    };
  }

  /**
   * Deterministic zero-trust ReAct engine ensuring zero hallucinations
   * and strict adherence to double-entry rules.
   */
  private async runDeterministicReActEngine(
    invoice: ExtractedInvoice,
    reactSteps: ReActStep[],
    onStep?: StepCallback
  ): Promise<OrchestrationResult> {
    let stepCount = 1;

    // Helper to emit and record step
    const emitStep = (step: ReActStep) => {
      step.timestamp = new Date().toISOString();
      reactSteps.push(step);
      if (onStep) onStep(step);
    };

    // Step 1: Pre-Audit Confidence Check
    const confThought = `Evaluating extraction confidence score (${(invoice.confidenceScore * 100).toFixed(0)}%). Zero-trust minimum threshold is 85%.`;
    if (invoice.confidenceScore < 0.85) {
      const discAction = {
        tool: 'flagDiscrepancyForReview',
        args: {
          reason: `Low confidence extraction (${(invoice.confidenceScore * 100).toFixed(1)}%) for ${invoice.invoiceNumber}. Needs manual audit.`,
          varianceAmount: 0,
          recommendedAction: 'Verify invoice scan and OCR readings before posting.',
        },
      };
      const observation = await flagDiscrepancyForReview(discAction.args);
      emitStep({
        step: stepCount++,
        thought: confThought + ' Confidence is too low. Triggering human-in-the-loop audit.',
        action: discAction,
        observation,
      });

      return {
        status: 'FLAGGED_FOR_REVIEW',
        reference: invoice.invoiceNumber,
        vendor: invoice.vendor,
        totalAmount: invoice.totalAmount,
        balanceVerified: false,
        discrepancy: observation,
        reactSteps,
        auditSummary: `Audit flagged due to low extraction confidence (${(invoice.confidenceScore * 100).toFixed(1)}%).`,
      };
    }

    emitStep({
      step: stepCount++,
      thought: confThought + ' Confidence check passed (>= 85%). Proceeding to ledger accounts discovery.',
    });

    // Step 2: Query Ledger Accounts (Action: fetchLedgerAccounts)
    const accountsAction = { tool: 'fetchLedgerAccounts', args: {} };
    const accountsObs = await fetchLedgerAccounts({});
    emitStep({
      step: stepCount++,
      thought: 'Discovering active chart of accounts from PostgreSQL database to map debit and credit allocations.',
      action: accountsAction,
      observation: accountsObs,
    });

    const accounts = accountsObs.accounts || [];
    const expenseAcc = accounts.find((a: any) => a.id === 'acc_expense') || { id: 'acc_expense' };
    const taxAcc = accounts.find((a: any) => a.id === 'acc_tax_payable') || { id: 'acc_tax_payable' };
    const apAcc = accounts.find((a: any) => a.id === 'acc_ap') || { id: 'acc_ap' };

    // Step 3: Verify Tax Compliance (Action: verifyTaxCompliance)
    const taxArgs = {
      taxId: invoice.taxId,
      invoiceAmount: invoice.subtotal,
      calculatedTax: invoice.taxAmount,
    };
    const taxObs = await verifyTaxCompliance(taxArgs);
    emitStep({
      step: stepCount++,
      thought: `Auditing tax compliance for Vendor Tax ID: ${invoice.taxId}. Checking if subtotal ($${invoice.subtotal}) and stated tax ($${invoice.taxAmount}) conform to expected tax rates.`,
      action: { tool: 'verifyTaxCompliance', args: taxArgs },
      observation: taxObs,
    });

    if (!taxObs.compliant) {
      const discAction = {
        tool: 'flagDiscrepancyForReview',
        args: {
          reason: `Tax compliance mismatch for invoice ${invoice.invoiceNumber}: ${taxObs.details.notes}`,
          varianceAmount: taxObs.taxVariance,
          recommendedAction: 'Verify vendor tax certificate and re-calculate tax line.',
        },
      };
      const discObs = await flagDiscrepancyForReview(discAction.args);
      emitStep({
        step: stepCount++,
        thought: `Tax compliance failed with variance $${taxObs.taxVariance.toFixed(2)}. Flagging discrepancy for human review.`,
        action: discAction,
        observation: discObs,
      });

      return {
        status: 'FLAGGED_FOR_REVIEW',
        reference: invoice.invoiceNumber,
        vendor: invoice.vendor,
        totalAmount: invoice.totalAmount,
        balanceVerified: false,
        discrepancy: discObs,
        reactSteps,
        auditSummary: `Tax non-compliance flagged. Variance: ${taxObs.taxVariance.toFixed(2)}.`,
      };
    }

    // Step 4: Construct and Validate Double-Entry Journal Lines
    const lines = [
      {
        accountId: expenseAcc.id,
        debit: Number(Number(invoice.subtotal).toFixed(2)),
        credit: 0,
      },
      {
        accountId: taxAcc.id,
        debit: Number(Number(invoice.taxAmount).toFixed(2)),
        credit: 0,
      },
      {
        accountId: apAcc.id,
        debit: 0,
        credit: Number(Number(invoice.totalAmount).toFixed(2)),
      },
    ];

    const sumDebits = lines.reduce((s, l) => s + l.debit, 0);
    const sumCredits = lines.reduce((s, l) => s + l.credit, 0);
    const variance = Math.abs(sumDebits - sumCredits);

    const balanceThought = `Validating double-entry balance: Debits = $${sumDebits.toFixed(2)}, Credits = $${sumCredits.toFixed(2)}, Variance = $${variance.toFixed(4)}. Zero-trust limit is < 0.001.`;

    // Zero-Trust Constraint: abs(sum(debits) - sum(credits)) < 0.001
    if (variance >= 0.001) {
      const discAction = {
        tool: 'flagDiscrepancyForReview',
        args: {
          reason: `Unbalanced transaction: Debits ($${sumDebits.toFixed(2)}) != Credits ($${sumCredits.toFixed(2)}). Variance: $${variance.toFixed(4)}`,
          varianceAmount: variance,
          recommendedAction: 'Audit line item subtotals and vendor calculation.',
        },
      };
      const discObs = await flagDiscrepancyForReview(discAction.args);
      emitStep({
        step: stepCount++,
        thought: balanceThought + ' Transaction is UNBALANCED. Rejecting and logging discrepancy.',
        action: discAction,
        observation: discObs,
      });

      return {
        status: 'REJECTED',
        reference: invoice.invoiceNumber,
        vendor: invoice.vendor,
        totalAmount: invoice.totalAmount,
        balanceVerified: false,
        discrepancy: discObs,
        reactSteps,
        auditSummary: `Transaction rejected: Unbalanced journal entry (Variance: ${variance.toFixed(4)}).`,
      };
    }

    emitStep({
      step: stepCount++,
      thought: balanceThought + ' Perfect double-entry balance verified (0.00 variance).',
    });

    // Step 5: Post Journal Entry (Action: postJournalEntry)
    const postAction = {
      tool: 'postJournalEntry',
      args: {
        reference: invoice.invoiceNumber,
        description: `Invoice ${invoice.invoiceNumber} from ${invoice.vendor}`,
        lines,
      },
    };
    const postObs = await postJournalEntry(postAction.args);
    emitStep({
      step: stepCount++,
      thought: 'Persisting balanced double-entry transaction to PostgreSQL ledger.',
      action: postAction,
      observation: postObs,
    });

    return {
      status: postObs.success ? 'POSTED' : 'REJECTED',
      reference: invoice.invoiceNumber,
      vendor: invoice.vendor,
      totalAmount: invoice.totalAmount,
      balanceVerified: postObs.balanceVerified,
      journalEntry: postObs,
      reactSteps,
      auditSummary: `Invoice ${invoice.invoiceNumber} successfully audited and posted to ledger. Total: $${invoice.totalAmount.toFixed(2)} ${invoice.currency || 'USD'}.`,
    };
  }
}
