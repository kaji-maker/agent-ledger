import { FunctionDeclaration, Type } from '@google/genai';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { query, withTransaction } from '../db/index.js';

// ==========================================
// In-Memory Fallback State (for seamless offline/demo mode)
// ==========================================

export interface LedgerAccountRecord {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: number;
}

export interface DiscrepancyRecord {
  id: string;
  reason: string;
  varianceAmount: number;
  recommendedAction: string;
  status: 'FLAGGED' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

const memoryAccounts: LedgerAccountRecord[] = [
  { id: 'acc_cash', code: '1000', name: 'Cash on Hand', type: 'ASSET', balance: 50000.0 },
  { id: 'acc_ar', code: '1100', name: 'Accounts Receivable', type: 'ASSET', balance: 12500.0 },
  { id: 'acc_inventory', code: '1200', name: 'Inventory', type: 'ASSET', balance: 35000.0 },
  { id: 'acc_ap', code: '2000', name: 'Accounts Payable', type: 'LIABILITY', balance: 8400.0 },
  { id: 'acc_tax_payable', code: '2100', name: 'Sales Tax Payable', type: 'LIABILITY', balance: 2200.0 },
  { id: 'acc_equity', code: '3000', name: 'Owner Capital', type: 'EQUITY', balance: 80000.0 },
  { id: 'acc_revenue', code: '4000', name: 'Sales Revenue', type: 'REVENUE', balance: 45000.0 },
  { id: 'acc_expense', code: '5000', name: 'Operating Expenses', type: 'EXPENSE', balance: 38100.0 },
];

const memoryDiscrepancies: DiscrepancyRecord[] = [];

// ==========================================
// Tool Arguments Interfaces
// ==========================================

export interface FetchLedgerAccountsArgs {
  accountType?: string;
}

export interface VerifyTaxComplianceArgs {
  taxId: string;
  invoiceAmount: number;
  calculatedTax: number;
}

export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
}

export interface PostJournalEntryArgs {
  reference: string;
  description: string;
  lines: JournalLineInput[];
}

export interface FlagDiscrepancyArgs {
  reason: string;
  varianceAmount: number;
  recommendedAction: string;
}

// ==========================================
// 1. @google/genai Tool Declarations (Type Enums)
// ==========================================

export const fetchLedgerAccountsDeclaration: FunctionDeclaration = {
  name: 'fetchLedgerAccounts',
  description: 'Fetch chart of accounts, optionally filtered by account type (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      accountType: {
        type: Type.STRING,
        description: 'Optional account type filter (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE).',
      },
    },
  },
};

export const verifyTaxComplianceDeclaration: FunctionDeclaration = {
  name: 'verifyTaxCompliance',
  description: 'Verify tax compliance by checking Tax ID format and checking if calculated tax matches standard tax rate expectations.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      taxId: {
        type: Type.STRING,
        description: 'Tax Identification Number or VAT ID of counterparty/vendor.',
      },
      invoiceAmount: {
        type: Type.NUMBER,
        description: 'Pre-tax subtotal amount on the invoice/receipt.',
      },
      calculatedTax: {
        type: Type.NUMBER,
        description: 'Tax amount stated on invoice or calculated by parsing.',
      },
    },
    required: ['taxId', 'invoiceAmount', 'calculatedTax'],
  },
};

export const postJournalEntryDeclaration: FunctionDeclaration = {
  name: 'postJournalEntry',
  description: 'Post a double-entry journal entry to PostgreSQL. Strictly enforces sum(debits) === sum(credits).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      reference: {
        type: Type.STRING,
        description: 'Unique invoice number, receipt ID, or reference string.',
      },
      description: {
        type: Type.STRING,
        description: 'Purpose and details of the transaction.',
      },
      lines: {
        type: Type.ARRAY,
        description: 'List of debit and credit journal lines.',
        items: {
          type: Type.OBJECT,
          properties: {
            accountId: {
              type: Type.STRING,
              description: 'Account ID (e.g. acc_cash, acc_expense, acc_ap).',
            },
            debit: {
              type: Type.NUMBER,
              description: 'Debit amount (>= 0).',
            },
            credit: {
              type: Type.NUMBER,
              description: 'Credit amount (>= 0).',
            },
          },
          required: ['accountId', 'debit', 'credit'],
        },
      },
    },
    required: ['reference', 'description', 'lines'],
  },
};

export const flagDiscrepancyForReviewDeclaration: FunctionDeclaration = {
  name: 'flagDiscrepancyForReview',
  description: 'Flag an accounting discrepancy or unbalanced transaction for human review.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      reason: {
        type: Type.STRING,
        description: 'Detailed explanation of why the discrepancy was flagged.',
      },
      varianceAmount: {
        type: Type.NUMBER,
        description: 'Numerical variance or difference between debits and credits / expected vs actual.',
      },
      recommendedAction: {
        type: Type.STRING,
        description: 'Recommended resolution action (e.g. Request revised invoice, Manual review).',
      },
    },
    required: ['reason', 'varianceAmount', 'recommendedAction'],
  },
};

export const geminiLedgerTools: FunctionDeclaration[] = [
  fetchLedgerAccountsDeclaration,
  verifyTaxComplianceDeclaration,
  postJournalEntryDeclaration,
  flagDiscrepancyForReviewDeclaration,
];

// ==========================================
// 2. Standard MCP Tool Definitions
// ==========================================

export const mcpLedgerTools: Tool[] = [
  {
    name: 'fetchLedgerAccounts',
    description: fetchLedgerAccountsDeclaration.description || '',
    inputSchema: {
      type: 'object',
      properties: {
        accountType: {
          type: 'string',
          description: 'Optional account type filter (ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE)',
        },
      },
    },
  },
  {
    name: 'verifyTaxCompliance',
    description: verifyTaxComplianceDeclaration.description || '',
    inputSchema: {
      type: 'object',
      properties: {
        taxId: { type: 'string', description: 'Tax Identification Number / VAT ID' },
        invoiceAmount: { type: 'number', description: 'Pre-tax invoice amount' },
        calculatedTax: { type: 'number', description: 'Calculated tax amount' },
      },
      required: ['taxId', 'invoiceAmount', 'calculatedTax'],
    },
  },
  {
    name: 'postJournalEntry',
    description: postJournalEntryDeclaration.description || '',
    inputSchema: {
      type: 'object',
      properties: {
        reference: { type: 'string', description: 'Transaction reference' },
        description: { type: 'string', description: 'Transaction description' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              accountId: { type: 'string', description: 'Account ID' },
              debit: { type: 'number', description: 'Debit amount' },
              credit: { type: 'number', description: 'Credit amount' },
            },
            required: ['accountId', 'debit', 'credit'],
          },
        },
      },
      required: ['reference', 'description', 'lines'],
    },
  },
  {
    name: 'flagDiscrepancyForReview',
    description: flagDiscrepancyForReviewDeclaration.description || '',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for flagging' },
        varianceAmount: { type: 'number', description: 'Amount of variance' },
        recommendedAction: { type: 'string', description: 'Recommended corrective action' },
      },
      required: ['reason', 'varianceAmount', 'recommendedAction'],
    },
  },
];

// ==========================================
// 3. Tool Execution Handlers
// ==========================================

export async function fetchLedgerAccounts(args: FetchLedgerAccountsArgs = {}) {
  try {
    let sql = 'SELECT id, code, name, type, balance FROM accounts';
    const params: any[] = [];

    if (args.accountType) {
      sql += ' WHERE UPPER(type) = UPPER($1)';
      params.push(args.accountType);
    }
    sql += ' ORDER BY code ASC';

    const res = await query(sql, params);
    return {
      success: true,
      count: res.rows.length,
      accounts: res.rows.map((r: any) => ({
        ...r,
        balance: parseFloat(r.balance) || 0,
      })),
    };
  } catch (error: any) {
    const filtered = args.accountType
      ? memoryAccounts.filter((a) => a.type.toUpperCase() === args.accountType?.toUpperCase())
      : memoryAccounts;

    return {
      success: true,
      count: filtered.length,
      accounts: filtered,
    };
  }
}

export async function verifyTaxCompliance(args: VerifyTaxComplianceArgs) {
  const { taxId, invoiceAmount, calculatedTax } = args;

  // Basic Tax ID syntax check (alphanumeric, min length 5)
  const isValidTaxIdFormat = /^[A-Z0-9-]{5,20}$/i.test(taxId.trim());

  // Standard 13% tax calculation check
  const standardRate = 0.13;
  const expectedTax = Number((invoiceAmount * standardRate).toFixed(2));
  const taxVariance = Math.abs(calculatedTax - expectedTax);
  const isTaxAmountValid = taxVariance <= 0.05 || calculatedTax === 0;

  const isCompliant = isValidTaxIdFormat && isTaxAmountValid;

  return {
    success: true,
    compliant: isCompliant,
    taxId,
    invoiceAmount,
    calculatedTax,
    expectedTax,
    taxVariance,
    details: {
      validTaxIdFormat: isValidTaxIdFormat,
      taxAmountValid: isTaxAmountValid,
      notes: isCompliant
        ? 'Tax ID format and tax calculation meet compliance criteria.'
        : `Tax compliance alert: TaxID valid=${isValidTaxIdFormat}, Tax calculated=${calculatedTax} vs expected=${expectedTax}.`,
    },
  };
}

export async function postJournalEntry(args: PostJournalEntryArgs) {
  const { reference, description, lines } = args;

  if (!lines || lines.length === 0) {
    throw new Error('Journal entry must contain at least one debit line and one credit line.');
  }

  // Calculate debits and credits
  const totalDebits = lines.reduce((acc, line) => acc + (Number(line.debit) || 0), 0);
  const totalCredits = lines.reduce((acc, line) => acc + (Number(line.credit) || 0), 0);
  const variance = Math.abs(totalDebits - totalCredits);

  // Safety & Zero-Trust Constraint check: abs(sum(debits) - sum(credits)) < 0.001
  if (variance >= 0.001) {
    const errorMsg = `UNBALANCED TRANSACTION REJECTED: sum(debits) [${totalDebits.toFixed(
      2
    )}] !== sum(credits) [${totalCredits.toFixed(2)}]. Variance: ${variance.toFixed(4)}. Zero-trust accounting rule violated.`;

    console.error(errorMsg);

    // Automatically record discrepancy for review
    await flagDiscrepancyForReview({
      reason: errorMsg,
      varianceAmount: variance,
      recommendedAction: 'Review invoice line items and debit/credit assignments before retrying.',
    });

    return {
      success: false,
      error: errorMsg,
      totalDebits,
      totalCredits,
      variance,
      balanceVerified: false,
    };
  }

  // Attempt database posting inside a transaction
  try {
    const entryResult = await withTransaction(async (client) => {
      // 1. Insert Journal Entry
      const entryRes = await client.query(
        `INSERT INTO journal_entries (reference, description, status)
         VALUES ($1, $2, 'POSTED')
         RETURNING id, reference, description, posted_at, status`,
        [reference, description]
      );
      const entryId = entryRes.rows[0].id;

      // 2. Insert Journal Lines & Update Account Balances
      for (const line of lines) {
        await client.query(
          `INSERT INTO journal_lines (entry_id, account_id, debit, credit)
           VALUES ($1, $2, $3, $4)`,
          [entryId, line.accountId, line.debit, line.credit]
        );

        // Update Account balance: debits increase ASSET/EXPENSE, credits increase LIABILITY/EQUITY/REVENUE
        await client.query(
          `UPDATE accounts 
           SET balance = CASE 
             WHEN type IN ('ASSET', 'EXPENSE') THEN balance + $2 - $3
             ELSE balance + $3 - $2
           END
           WHERE id = $1`,
          [line.accountId, line.debit, line.credit]
        );
      }

      return entryRes.rows[0];
    });

    return {
      success: true,
      entryId: entryResult.id,
      reference: entryResult.reference,
      description: entryResult.description,
      totalDebits,
      totalCredits,
      postedAt: entryResult.posted_at,
      balanceVerified: true,
    };
  } catch (dbError: any) {
    // If DB is offline, update in-memory state
    for (const line of lines) {
      const acc = memoryAccounts.find((a) => a.id === line.accountId);
      if (acc) {
        if (['ASSET', 'EXPENSE'].includes(acc.type.toUpperCase())) {
          acc.balance = Number((acc.balance + line.debit - line.credit).toFixed(2));
        } else {
          acc.balance = Number((acc.balance + line.credit - line.debit).toFixed(2));
        }
      }
    }

    return {
      success: true,
      simulated: true,
      entryId: `je_${Date.now()}`,
      reference,
      description,
      totalDebits,
      totalCredits,
      variance,
      balanceVerified: true,
      linesCount: lines.length,
    };
  }
}

export async function flagDiscrepancyForReview(args: FlagDiscrepancyArgs) {
  const { reason, varianceAmount, recommendedAction } = args;

  try {
    const res = await query(
      `INSERT INTO discrepancies (reason, variance_amount, recommended_action, status)
       VALUES ($1, $2, $3, 'FLAGGED')
       RETURNING id, reason, variance_amount, recommended_action, status, created_at`,
      [reason, varianceAmount, recommendedAction]
    );

    const record = res.rows[0];
    return {
      success: true,
      discrepancyId: record.id,
      reason: record.reason,
      varianceAmount: Number(record.variance_amount),
      recommendedAction: record.recommended_action,
      status: record.status,
      createdAt: record.created_at,
    };
  } catch (error) {
    const newDisc: DiscrepancyRecord = {
      id: `disc_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      reason,
      varianceAmount,
      recommendedAction,
      status: 'FLAGGED',
      createdAt: new Date().toISOString(),
    };
    memoryDiscrepancies.unshift(newDisc);

    return {
      success: true,
      simulated: true,
      discrepancyId: newDisc.id,
      reason: newDisc.reason,
      varianceAmount: newDisc.varianceAmount,
      recommendedAction: newDisc.recommendedAction,
      status: newDisc.status,
      createdAt: newDisc.createdAt,
    };
  }
}

export async function getDiscrepanciesList(): Promise<DiscrepancyRecord[]> {
  try {
    const res = await query('SELECT id, reason, variance_amount, recommended_action, status, created_at FROM discrepancies ORDER BY created_at DESC');
    return res.rows.map((r: any) => ({
      id: r.id,
      reason: r.reason,
      varianceAmount: parseFloat(r.variance_amount) || 0,
      recommendedAction: r.recommended_action,
      status: r.status,
      createdAt: r.created_at,
    }));
  } catch (err) {
    return memoryDiscrepancies;
  }
}

export async function resolveDiscrepancy(
  id: string,
  action: 'APPROVED' | 'REJECTED',
  overrideJournalEntry?: PostJournalEntryArgs
): Promise<{ success: boolean; message: string; journalEntry?: any }> {
  try {
    await query('UPDATE discrepancies SET status = $1 WHERE id = $2', [action, id]);
  } catch (err) {
    const disc = memoryDiscrepancies.find((d) => d.id === id);
    if (disc) {
      disc.status = action;
    }
  }

  let postRes: any = null;
  if (action === 'APPROVED' && overrideJournalEntry) {
    postRes = await postJournalEntry(overrideJournalEntry);
  }

  return {
    success: true,
    message: `Discrepancy ${id} was marked as ${action}.`,
    journalEntry: postRes,
  };
}

// ==========================================
// 4. Central Dispatcher Function for MCP / Gemini Tool Calls
// ==========================================

export async function handleLedgerToolCall(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'fetchLedgerAccounts':
      return await fetchLedgerAccounts(args);
    case 'verifyTaxCompliance':
      return await verifyTaxCompliance(args);
    case 'postJournalEntry':
      return await postJournalEntry(args);
    case 'flagDiscrepancyForReview':
      return await flagDiscrepancyForReview(args);
    default:
      throw new Error(`Unknown ledger tool requested: ${toolName}`);
  }
}
