#!/usr/bin/env bash
# ==============================================================================
# AgentLedger - Google Cloud Run Deployment Script
# Configured with Google Cloud SQL Proxy & GEMINI_API_KEY environment injection
# ==============================================================================

set -euo pipefail

# Ensure gcloud CLI is in PATH
export PATH="$HOME/google-cloud-sdk/bin:$PATH"

# Load local .env if available
if [[ -f .env ]]; then
  # export non-commented lines from .env
  export $(grep -v '^#' .env | xargs -d '\n' 2>/dev/null || true)
fi

# ------------------------------------------------------------------------------
# Configuration Variables (Override via environment or modify defaults below)
# ------------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo '')}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-agent-ledger}"
AR_REPO="${AR_REPO:-agent-ledger-repo}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Cloud SQL & Database Configuration
INSTANCE_CONNECTION_NAME="${INSTANCE_CONNECTION_NAME:-${PROJECT_ID}:${REGION}:agent-ledger-db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-agent_ledger}"
DB_PASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"

# Gemini API Key Configuration
GEMINI_API_KEY="${GEMINI_API_KEY:-}"
GEMINI_API_KEY_SECRET="${GEMINI_API_KEY_SECRET:-gemini-api-key}"
DB_PASS_SECRET="${DB_PASS_SECRET:-agent-ledger-db-password}"

# Scaling & Resource Limits
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"
MEMORY="${MEMORY:-1Gi}"
CPU="${CPU:-1}"
TIMEOUT="${TIMEOUT:-300s}"

# ------------------------------------------------------------------------------
# Pre-flight Checks
# ------------------------------------------------------------------------------
echo "======================================================================"
echo "          🚀 Deploying AgentLedger to Google Cloud Run                "
echo "======================================================================"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "❌ Error: PROJECT_ID is not set and could not be detected from gcloud."
  echo "   Please set your project: export PROJECT_ID=\"your-gcp-project-id\""
  exit 1
fi

echo "📋 Configuration Summary:"
echo "   - Project ID:                ${PROJECT_ID}"
echo "   - Region:                    ${REGION}"
echo "   - Service Name:              ${SERVICE_NAME}"
echo "   - Cloud SQL Connection:      ${INSTANCE_CONNECTION_NAME}"
echo "   - Database / User:           ${DB_NAME} / ${DB_USER}"
if [[ -n "${GEMINI_API_KEY}" ]]; then
  echo "   - Gemini API Key Injection:  Direct Environment Variable (Configured)"
else
  echo "   - Gemini API Key Injection:  Secret Manager (${GEMINI_API_KEY_SECRET})"
fi
echo ""

# ------------------------------------------------------------------------------
# 1. Enable Required GCP APIs
# ------------------------------------------------------------------------------
echo "1️⃣  Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  --project="${PROJECT_ID}"

# ------------------------------------------------------------------------------
# 2. Setup Artifact Registry Repository
# ------------------------------------------------------------------------------
echo "2️⃣  Verifying Artifact Registry repository..."
if ! gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "   Creating Artifact Registry repository '${AR_REPO}' in ${REGION}..."
  gcloud artifacts repositories create "${AR_REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Docker repository for AgentLedger microservices" \
    --project="${PROJECT_ID}"
else
  echo "   Artifact Registry repository '${AR_REPO}' exists."
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:${IMAGE_TAG}"

# ------------------------------------------------------------------------------
# 3. Build & Submit Container Image via Google Cloud Build
# ------------------------------------------------------------------------------
echo "3️⃣  Building container image via Cloud Build..."
echo "   Target Image: ${IMAGE_URI}"
gcloud builds submit --tag "${IMAGE_URI}" --project="${PROJECT_ID}" .

# ------------------------------------------------------------------------------
# 4. Construct Environment Variables & Secrets Flags for Cloud Run
# ------------------------------------------------------------------------------
echo "4️⃣  Configuring environment variable and secret injections..."

ENV_VARS="NODE_ENV=production"
ENV_VARS="${ENV_VARS},PORT=8080"
ENV_VARS="${ENV_VARS},PGHOST=/cloudsql/${INSTANCE_CONNECTION_NAME}"
ENV_VARS="${ENV_VARS},PGPORT=5432"
ENV_VARS="${ENV_VARS},PGUSER=${DB_USER}"
ENV_VARS="${ENV_VARS},PGDATABASE=${DB_NAME}"
ENV_VARS="${ENV_VARS},PGMAX_CONNECTIONS=20"

# Inject GEMINI_API_KEY as direct env var if provided, otherwise via Secret Manager
SECRETS_ARRAY=()

if [[ -n "${GEMINI_API_KEY}" ]]; then
  ENV_VARS="${ENV_VARS},GEMINI_API_KEY=${GEMINI_API_KEY}"
  echo "   -> GEMINI_API_KEY mapped via --set-env-vars"
else
  SECRETS_ARRAY+=("GEMINI_API_KEY=${GEMINI_API_KEY_SECRET}:latest")
  echo "   -> GEMINI_API_KEY mapped via Secret Manager (${GEMINI_API_KEY_SECRET})"
fi

# Inject Database Password
if [[ -n "${DB_PASSWORD}" ]]; then
  ENV_VARS="${ENV_VARS},PGPASSWORD=${DB_PASSWORD}"
  echo "   -> PGPASSWORD mapped via --set-env-vars"
else
  SECRETS_ARRAY+=("PGPASSWORD=${DB_PASS_SECRET}:latest")
  echo "   -> PGPASSWORD mapped via Secret Manager (${DB_PASS_SECRET})"
fi

# Build deployment command parameters
DEPLOY_CMD=(
  gcloud run deploy "${SERVICE_NAME}"
  --image="${IMAGE_URI}"
  --platform="managed"
  --region="${REGION}"
  --project="${PROJECT_ID}"
  --add-cloudsql-instances="${INSTANCE_CONNECTION_NAME}"
  --set-env-vars="${ENV_VARS}"
  --cpu="${CPU}"
  --memory="${MEMORY}"
  --min-instances="${MIN_INSTANCES}"
  --max-instances="${MAX_INSTANCES}"
  --timeout="${TIMEOUT}"
  --port=8080
  --allow-unauthenticated
)

if [[ ${#SECRETS_ARRAY[@]} -gt 0 ]]; then
  SECRETS_JOINED=$(IFS=,; echo "${SECRETS_ARRAY[*]}")
  DEPLOY_CMD+=(--set-secrets="${SECRETS_JOINED}")
fi

# ------------------------------------------------------------------------------
# 5. Deploy to Google Cloud Run
# ------------------------------------------------------------------------------
echo "5️⃣  Deploying service to Cloud Run with Cloud SQL proxy..."
"${DEPLOY_CMD[@]}"

# ------------------------------------------------------------------------------
# 6. Retrieve Service URL and Verify Health
# ------------------------------------------------------------------------------
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --platform="managed" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo ""
echo "======================================================================"
echo "✅ Deployment completed successfully!"
echo "   - Service URL:     ${SERVICE_URL}"
echo "   - Health Check:    ${SERVICE_URL}/api/health"
echo "   - Web Dashboard:   ${SERVICE_URL}"
echo "======================================================================"
