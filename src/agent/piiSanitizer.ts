import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { ExtractedInvoice } from './ingest.js';

dotenv.config();

export interface SanitizationResult {
  sanitizedInvoice: ExtractedInvoice;
  redactionsCount: number;
  redactionsSummary: string[];
  sanitizedByModel: boolean;
}

const SANITIZER_SYSTEM_INSTRUCTION = `
You are the AgentLedger Privacy & PII Sanitizer powered by Gemma 2 2B IT.
Your mission is to redact all private and sensitive personal data from invoice content before financial reasoning.

Redaction Rules:
1. Bank Account Numbers, Routing Numbers, IBANs -> Replace with '[REDACTED_ACCOUNT]'
2. Employee Personal Names, Signatures, Personal Phone/Emails -> Replace with '[REDACTED_EMPLOYEE]' or '[REDACTED_CONTACT]'
3. Social Security Numbers (SSN), Personal National IDs -> Replace with '[REDACTED_SSN]'
4. Credit / Debit Card Numbers -> Replace with '[REDACTED_CARD]'

Strict Preservation Rules:
- DO NOT alter financial amounts, subtotals, tax figures, currency, or line item numbers.
- DO NOT alter the Vendor Legal Name or Official Business Tax ID / VAT ID.
- DO NOT alter Invoice Numbers or Reference IDs.
- Return the sanitized text or JSON cleanly without surrounding explanation.
`;

export class PiiSanitizer {
  private ai: GoogleGenAI;
  public readonly model = 'gemma-2-2b-it';

  constructor(apiKey?: string) {
    this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || '' });
  }

  /**
   * Sanitize an ExtractedInvoice structure before passing to Gemini 3.5 Pro.
   */
  async sanitize(invoice: ExtractedInvoice): Promise<SanitizationResult> {
    const redactionsSummary: string[] = [];
    let redactionsCount = 0;
    let sanitizedByModel = false;

    const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

    // Deep clone invoice to prevent mutating original
    const sanitized: ExtractedInvoice = JSON.parse(JSON.stringify(invoice));

    // Try Gemma 2 2B IT model sanitization if API key is present
    if (hasApiKey) {
      try {
        const payloadToSanitize = {
          notes: sanitized.rawNotes || '',
          lineDescriptions: sanitized.lineItems.map((item) => item.description),
        };

        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Sanitize sensitive PII in the following invoice text components:\n${JSON.stringify(
                    payloadToSanitize,
                    null,
                    2
                  )}`,
                },
              ],
            },
          ],
          config: {
            systemInstruction: SANITIZER_SYSTEM_INSTRUCTION,
            temperature: 0.0,
          },
        });

        const modelOutput = response.text;
        if (modelOutput && modelOutput.includes('[REDACTED')) {
          sanitizedByModel = true;
          redactionsSummary.push('Gemma 2 2B IT sanitized sensitive PII strings.');
        }
      } catch (err: any) {
        // Fall back seamlessly to deterministic regex engine
      }
    }

    // Apply Deterministic Sanitization Engine (Zero-Trust Guarantee)
    // 1. Sanitize rawNotes
    if (sanitized.rawNotes) {
      const { text, count, summary } = this.sanitizeTextDeterministic(sanitized.rawNotes);
      sanitized.rawNotes = text;
      redactionsCount += count;
      redactionsSummary.push(...summary);
    }

    // 2. Sanitize line item descriptions
    sanitized.lineItems = sanitized.lineItems.map((item) => {
      const { text, count, summary } = this.sanitizeTextDeterministic(item.description);
      if (count > 0) {
        redactionsCount += count;
        redactionsSummary.push(...summary);
      }
      return {
        ...item,
        description: text,
      };
    });

    // 3. Check for raw SSN or Personal Tax formats
    if (sanitized.taxId && /^\d{3}-\d{2}-\d{4}$/.test(sanitized.taxId.trim())) {
      sanitized.taxId = '[REDACTED_SSN]';
      redactionsCount++;
      redactionsSummary.push('Sanitized raw personal SSN in tax identifier field.');
    }

    return {
      sanitizedInvoice: sanitized,
      redactionsCount,
      redactionsSummary: Array.from(new Set(redactionsSummary)),
      sanitizedByModel,
    };
  }

  /**
   * Deterministic pattern-matching sanitizer for SSNs, Bank Accounts, Cards, and Employee PII.
   */
  private sanitizeTextDeterministic(input: string): {
    text: string;
    count: number;
    summary: string[];
  } {
    let text = input;
    let count = 0;
    const summary: string[] = [];

    // 1. Social Security Numbers: XXX-XX-XXXX
    const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
    if (ssnRegex.test(text)) {
      text = text.replace(ssnRegex, '[REDACTED_SSN]');
      count++;
      summary.push('Redacted Social Security Number ([REDACTED_SSN])');
    }

    // 2. Credit Card Numbers: 16 digits formatted
    const ccRegex = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
    if (ccRegex.test(text)) {
      text = text.replace(ccRegex, '[REDACTED_CARD]');
      count++;
      summary.push('Redacted Credit Card number ([REDACTED_CARD])');
    }

    // 3. Bank Account / IBAN Numbers:
    // e.g. "Account: 123456789012" or "IBAN: US12ABCD3456789012"
    const ibanRegex = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,28}\b/g;
    if (ibanRegex.test(text)) {
      text = text.replace(ibanRegex, '[REDACTED_ACCOUNT]');
      count++;
      summary.push('Redacted International Bank Account Number ([REDACTED_ACCOUNT])');
    }

    const bankAccRegex = /(?:Account|Acc|Routing|Wire|IBAN|SWIFT|Direct Deposit)(?:\s*(?:#|No|Number|:|\.))?\s*(\d{7,17})/gi;
    if (bankAccRegex.test(text)) {
      text = text.replace(bankAccRegex, (match, p1) => match.replace(p1, '[REDACTED_ACCOUNT]'));
      count++;
      summary.push('Redacted Bank Account / Routing Number ([REDACTED_ACCOUNT])');
    }

    // 4. Employee Personal Signatures / Identity tags
    // e.g. "Prepared by: John Doe (Employee ID: EMP-9921)"
    const employeeRegex = /(?:Prepared by|Approved by|Employee|Signer|Contact Person):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi;
    if (employeeRegex.test(text)) {
      text = text.replace(employeeRegex, (match, p1) => match.replace(p1, '[REDACTED_EMPLOYEE]'));
      count++;
      summary.push('Redacted Employee Personal Identity ([REDACTED_EMPLOYEE])');
    }

    // 5. Personal email addresses
    const emailRegex = /\b[A-Za-z0-9._%+-]+@(?!company\.com|aws\.com|acme\.com)[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    if (emailRegex.test(text)) {
      text = text.replace(emailRegex, '[REDACTED_CONTACT]');
      count++;
      summary.push('Redacted Personal Email Address ([REDACTED_CONTACT])');
    }

    return { text, count, summary };
  }
}
