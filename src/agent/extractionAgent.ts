import { GoogleGenAI } from '@google/genai';
import { EXTRACTION_SYSTEM_PROMPT } from './prompts.js';

export interface ExtractedInvoiceData {
  vendorName: string;
  taxId: string;
  reference: string;
  date: string;
  currency: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  confidenceScore: number;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}

export class ExtractionAgent {
  private ai: GoogleGenAI;
  private modelName = 'gemini-3.5-flash';

  constructor(apiKey?: string) {
    this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || '' });
  }

  /**
   * Parse invoice document text or multimodal input into structured invoice data.
   */
  async extractInvoice(input: {
    rawText?: string;
    mimeType?: string;
    base64Data?: string;
  }): Promise<ExtractedInvoiceData> {
    try {
      const parts: any[] = [];

      if (input.base64Data && input.mimeType) {
        parts.push({
          inlineData: {
            mimeType: input.mimeType,
            data: input.base64Data,
          },
        });
      }

      if (input.rawText) {
        parts.push({
          text: `Extract structured accounting data from the following document content:\n${input.rawText}`,
        });
      }

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: parts,
        config: {
          systemInstruction: EXTRACTION_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
        },
      });

      const responseText = response.text || '{}';
      const parsed: ExtractedInvoiceData = JSON.parse(responseText);

      // Validate extraction math
      const calculatedTotal = Number(((parsed.subtotal || 0) + (parsed.taxAmount || 0)).toFixed(2));
      const variance = Math.abs(calculatedTotal - (parsed.totalAmount || 0));

      if (variance > 0.01) {
        console.warn(`Extraction math variance detected: calculated=${calculatedTotal}, reported=${parsed.totalAmount}`);
        parsed.confidenceScore = Math.min(parsed.confidenceScore || 1.0, 0.70);
      }

      return parsed;
    } catch (error: any) {
      console.error('ExtractionAgent parsing error:', error);
      // Fallback extraction structure
      return {
        vendorName: 'Unknown Vendor',
        taxId: 'UNKNOWN',
        reference: `INV-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        currency: 'USD',
        subtotal: 0,
        taxAmount: 0,
        totalAmount: 0,
        confidenceScore: 0.0,
        items: [],
      };
    }
  }
}
