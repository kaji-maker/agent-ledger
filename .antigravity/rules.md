# Antigravity Execution Rules: AgentLedger

1. **Stack**: Node.js v20+, TypeScript, `@google/genai`, `@modelcontextprotocol/sdk`, PostgreSQL (`pg`), Express.
2. **Models**:
   - Extraction: `gemini-3.5-flash` (multimodal invoice/receipt parsing to structured JSON).
   - Reasoning & Reconciliation: `gemini-3.5-pro` (context audit & MCP tool calling).
3. **Safety & Zero-Trust Constraints**:
   - Enforce double-entry accounting rule at tool level: `abs(sum(debits) - sum(credits)) < 0.001`.
   - Never commit an unbalanced transaction to PostgreSQL.
   - Low confidence (< 0.85) or variance > 0 triggers `flagDiscrepancyForReview`.
4. **Output Structure**:
   - `src/agent/`: Core reasoning loops and prompt templates.
   - `src/mcp/`: Tool definitions, schemas, and execution handlers.
   - `src/db/`: SQL migrations and pool client.
   - `src/api/`: Express routes for frontend/webhook interactions.
