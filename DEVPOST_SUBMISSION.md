# 🏆 Devpost Submission Guide: AgentLedger

Use this ready-to-paste guide when filling out your submission on Devpost for the **All Things Agentic Hackathon**.

---

## 📌 Project Overview

* **Project Title** (<=60 chars): **AgentLedger: Zero-Trust Accounting & Ledger Fleet**
* **Tagline / Elevator Pitch** (<=200 chars): Zero-trust AI accounting fleet powered by Gemini 2.5 & Gemma 2. Sanitizes PII, mathematically enforces double-entry balance rules, and streams reconciliations to Cloud SQL.
* **Category / Track**: **The Fortified Enterprise Fleet**

---

## 📝 Devpost Form Fields (Copy & Paste)

### 💡 Inspiration
In enterprise finance and auditing, "AI hallucinations" aren't just inconvenient—they are catastrophic. If a financial LLM hallucinates an account balance or posts an unbalanced journal entry, the entire general ledger is corrupted. 

We asked: *How can we build an autonomous financial agent that organizations can trust with their balance sheet?* 

The answer was **AgentLedger**: a zero-trust multi-model fleet where mathematical constraints (`abs(sum(debits) - sum(credits)) < 0.001`), privacy redaction, and compliance gates are strictly enforced at the **Model Context Protocol (MCP)** tool layer.

---

### ⚙️ What It Does
1. **Intelligent Multimodal Ingest (`gemini-2.5-flash`)**: Parses invoice scans, PDFs, and raw OCR text into strict, mathematically verified financial JSON schemas.
2. **Privacy Shield (`gemma-2-2b-it`)**: Redacts bank account numbers, routing codes, employee identities, and SSNs into privacy tokens (`[REDACTED_ACCOUNT]`, `[REDACTED_SSN]`) before reasoning.
3. **Autonomous ReAct Audit (`gemini-2.5-pro`)**: Implements a multi-turn Reason + Act loop that queries the chart of accounts, audits tax compliance, maps debits and credits, and detects mismatches.
4. **Zero-Trust Commitment & Rejection**:
   - **Balanced Entries**: Atomically posted to **Google Cloud SQL (PostgreSQL)**.
   - **Unbalanced or Low-Confidence Entries (<85%)**: Rejected and queued for Human-in-the-Loop review.
5. **Real-time SSE Dashboard & HITL Workflow**: Streams live agent thoughts, tool calls, and observations with an interactive **"Approve & Post"** override card.

---

### 🛠️ How We Built It
* **AI Models**: `gemini-2.5-pro` (ReAct reasoning), `gemini-2.5-flash` (multimodal extraction), `gemma-2-2b-it` (PII redaction).
* **SDKs & Frameworks**: `@google/genai` (Google Gen AI TypeScript SDK), `@modelcontextprotocol/sdk` (Model Context Protocol), Antigravity CLI.
* **Backend & Database**: Node.js v20+, TypeScript, Express (Server-Sent Events), PostgreSQL with ACID transaction pooling.
* **Google Cloud Infrastructure**:
  * **Google Cloud Run**: Containerized microservice deployment.
  * **Google Cloud SQL**: Managed PostgreSQL 16 instance connected via native Cloud SQL Proxy Unix sockets.
  * **Google Secret Manager**: Secure injection of `GEMINI_API_KEY` and database credentials.
  * **Google Cloud Build & Artifact Registry**: Automated CI/CD container build pipeline.

---

### 🧗 Challenges We Ran Into
* **Ensuring Zero Hallucinations**: Prompt instructions alone are not enough for double-entry bookkeeping. We solved this by enforcing zero-trust checks at the tool execution level inside [`src/mcp/ledgerTools.ts`](file:///home/kajibik/Development/agent-ledger/src/mcp/ledgerTools.ts), making it impossible for the agent to commit an unbalanced transaction.
* **PII Redaction without Corrupting Financial Numbers**: Distinguishing between account numbers (which must be redacted) and financial totals/quantities (which must be preserved). We paired Gemma 2 2B IT with strict preservation rules.

---

### 🏅 Accomplishments That We're Proud Of
* **100% Pass Rate on Zero-Trust Audit Suite**: 9/9 automated checks verifying mathematical balance, low-confidence safety thresholds, and PII protection.
* **Multi-Model Google Fleet**: Seamless pipeline orchestrating **Gemma 2 2B IT $\rightarrow$ Gemini 2.5 Flash $\rightarrow$ Gemini 2.5 Pro**.
* **Zero-Downtime Cloud Run Deployment**: Single-command script (`./deploy.sh`) connecting Cloud Run to Cloud SQL with Secret Manager integration.

---

### 📚 What We Learned
Enterprise-grade agentic workflows require a defense-in-depth architecture: combining fast models for extraction, specialized edge models for privacy, reasoning models for orchestration, and hard deterministic boundaries at the tool layer.

---

### 🔮 What's Next for AgentLedger
* ERP connectors for NetSuite, SAP, and QuickBooks via MCP sidecars.
* Automated multi-currency foreign exchange (FX) variance revaluation.
* Autonomous vendor discrepancy communication agent.

---

## 🎬 4-Minute Demo Video Script & Walkthrough

| Timestamp | Section | Talking Points & Visuals |
| :--- | :--- | :--- |
| **0:00 - 0:45** | **Problem & Value Prop** | "Financial AI cannot afford hallucinations. If an agent posts an unbalanced transaction, your ledger is broken. AgentLedger solves this with a zero-trust multi-model fleet." |
| **0:45 - 1:30** | **Architecture & Gemma Privacy Shield** | Show Mermaid diagram in `README.md`. Demonstrate how `gemma-2-2b-it` strips bank routing/SSN details into tokens before Gemini 2.5 Pro audits the transaction. |
| **1:30 - 2:30** | **Live ReAct Loop & Balanced Posting** | Open `http://localhost:8080`. Click "Balanced AWS" demo. Show the live SSE stream: Flash Ingest $\rightarrow$ Pro Reasoning $\rightarrow$ MCP Tool Calls $\rightarrow$ POSTED to PostgreSQL. Show live balance updates. |
| **2:30 - 3:15** | **Zero-Trust Rejection & Human-in-the-Loop** | Click "Unbalanced" demo. Show the agent mathematically rejecting the transaction ($250 variance) and logging it to the HITL queue. Demonstrate the "Approve & Post" modal. |
| **3:15 - 4:00** | **Google Cloud Infrastructure** | Show Cloud Run console / `.run.app` service URL, Cloud SQL Proxy connection, and Cloud Build artifact logs. Conclude with summary. |

---

## 📱 Social Media Post Draft (Bonus Points +0.2)

### Post for X (Twitter) & LinkedIn:
> 🚀 Excited to share **AgentLedger** for the Google #AllThingsAgenticHackathon!
>
> An enterprise-grade, zero-trust accounting fleet built with **Gemini 2.5 Pro**, **Gemini 2.5 Flash**, **Gemma 2**, and **Model Context Protocol (MCP)** on **Google Cloud Run & Cloud SQL**.
>
> 🔒 Gemma 2 2B PII Privacy Shield
> ⚡ Real-time SSE Agent ReAct Trace Streaming
> ⚖️ Mathematical Double-Entry Zero-Trust Enforcement
>
> Check out the repo & demo! #AllThingsAgenticHackathon #GoogleCloud #GeminiAI #AIagents #BuildWithAI
