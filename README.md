# Digital Twin

A live AI digital twin of **Vitor Alves** — persona-backed chat with conversation memory, deployed as a serverless AWS stack and provisioned with Terraform.

**Live demo:** [https://d2nt8d8279t9us.cloudfront.net/](https://d2nt8d8279t9us.cloudfront.net/)

The public demo shares a **global budget of 5 successful `/chat` calls per UTC day** (DynamoDB-backed) so Bedrock spend stays predictable while the architecture stays open to explore.

---

## Architecture

```text
Browser (Next.js static export)
    │  HTTPS
    ▼
CloudFront ──► S3 (frontend assets)
    │
    │  POST /chat · GET /quota
    ▼
API Gateway (HTTP) ──► Lambda (FastAPI + Mangum)
                           │
                           ├── Amazon Bedrock (Nova) — model inference
                           ├── S3 — per-session conversation memory
                           └── DynamoDB — shared daily chat quota
```

| Layer | Choice |
| --- | --- |
| UI | Next.js (static export) + TypeScript + Tailwind |
| CDN | CloudFront (HTTPS, edge cache) |
| API | API Gateway HTTP API → Lambda |
| App | FastAPI + Mangum |
| LLM | Amazon Bedrock (`Converse` API) |
| Memory | Private S3 objects keyed by `session_id` |
| Quota | DynamoDB counter (UTC calendar day, TTL cleanup) |
| IaC | Terraform workspaces (`dev` / `test` / `prod`) |
| CI/CD | GitHub Actions (OIDC → AWS, no long-lived keys) |

The browser never talks to Bedrock. It only calls the API; IAM and model access stay on AWS.

---

## Features

- Persona twin grounded in local profile data (`backend/data`)
- Session-aware chat history persisted in S3
- Shared daily rate limit (5 successful chats / UTC day) with soft UI messaging
- Request guardrails: length limits, UUID session IDs, control-character filtering, basic prompt-injection patterns
- CORS locked to the CloudFront (or custom domain) origin
- Least-privilege Lambda policy for S3 memory, Bedrock invoke, and DynamoDB quota

---

## CI/CD

GitHub Actions workflows under `.github/workflows/`:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `deploy.yaml` | Push to `main` or manual dispatch | Assumes AWS via OIDC, builds Lambda zip, `terraform apply`, builds frontend, syncs to S3, invalidates CloudFront |
| `destroy.yaml` | Manual dispatch + confirmation | Empties app buckets and destroys the selected workspace |

Auth uses **GitHub OIDC** → IAM role `github-actions-twin-deploy` (no AWS access keys in GitHub).

Required GitHub secrets (repo or environment):

- `AWS_ROLE_ARN`
- `AWS_ACCOUNT_ID`
- `DEFAULT_AWS_REGION`

Environments: `dev`, `test`, `prod` (matched to Terraform workspaces).

> Note: Repositories created after July 15, 2026 use GitHub’s [immutable OIDC subject claims](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/) (`repo:owner@id/repo@id:...`). The IAM trust policy must allow that format.

---

## Local development

### Backend

```bash
cd backend
cp ../.env.example ../.env   # fill AWS region / Bedrock access for local calls
uv sync
uv run uvicorn server:app --reload --port 8000
```

Without `RATE_LIMIT_TABLE`, the quota uses an in-process counter (resets when the process restarts).

### Frontend

```bash
cd frontend
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy

Prerequisites: AWS CLI, Terraform, Docker (Lambda package build), Node.js, `uv`.

```bash
./scripts/deploy.sh test    # or: dev | prod
./scripts/destroy.sh test
```

`deploy.sh` will:

1. Build `backend/lambda-deployment.zip`
2. Init Terraform with the remote S3 backend + workspace
3. Apply infrastructure (including DynamoDB quota table)
4. Write `frontend/.env.production` from the API Gateway output
5. Build the static export and sync to the frontend bucket

---

## Security notes

- Model credentials never ship to the client
- Conversation memory bucket is private (block public access)
- API CORS allow-list matches the CloudFront/custom domain origin
- Chat input validated before Bedrock is called; failed calls release a reserved quota slot
- Lambda IAM is scoped to the memory bucket, Bedrock invoke, and the quota table (not account-wide S3/Bedrock admin)
- Frontend S3 still uses a public website origin for CloudFront (acceptable for a static demo; tightening with OAC is a natural next step)

---

## Project layout

```text
.
├── frontend/               # Next.js UI (static export)
├── backend/                # FastAPI app, Lambda handler, persona data
├── terraform/              # AWS infrastructure
├── scripts/                # deploy.sh / destroy.sh
└── .github/workflows/      # CI/CD (deploy + destroy)
```

---

## API (high level)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/quota` | Shared daily usage (`used`, `remaining`, `daily_limit`) |
| `POST` | `/chat` | Chat turn (counts against quota only when successful) |

`POST /chat` returns `429` with a clear message when the shared daily limit is exhausted.
