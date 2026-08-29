import { query } from './index.js';

export async function initializeDatabase(): Promise<void> {
  const schemaSql = `
    CREATE TABLE IF NOT EXISTS accounts (
      id VARCHAR(50) PRIMARY KEY,
      code VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      type VARCHAR(30) NOT NULL,
      balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reference VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(30) NOT NULL DEFAULT 'POSTED'
    );

    CREATE TABLE IF NOT EXISTS journal_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_id VARCHAR(50) NOT NULL REFERENCES accounts(id),
      debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
      credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00
    );

    CREATE TABLE IF NOT EXISTS discrepancies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reason TEXT NOT NULL,
      variance_amount NUMERIC(15, 2) NOT NULL,
      recommended_action TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'FLAGGED',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Seed basic chart of accounts if empty
    INSERT INTO accounts (id, code, name, type, balance)
    VALUES 
      ('acc_cash', '1000', 'Cash on Hand', 'ASSET', 0.00),
      ('acc_ar', '1100', 'Accounts Receivable', 'ASSET', 0.00),
      ('acc_inventory', '1200', 'Inventory', 'ASSET', 0.00),
      ('acc_ap', '2000', 'Accounts Payable', 'LIABILITY', 0.00),
      ('acc_tax_payable', '2100', 'Sales Tax Payable', 'LIABILITY', 0.00),
      ('acc_equity', '3000', 'Owner Capital', 'EQUITY', 0.00),
      ('acc_revenue', '4000', 'Sales Revenue', 'REVENUE', 0.00),
      ('acc_expense', '5000', 'Operating Expenses', 'EXPENSE', 0.00)
    ON CONFLICT (id) DO NOTHING;
  `;

  try {
    await query(schemaSql);
    console.log('Database schema initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
  }
}
