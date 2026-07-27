# AI Digital Twin — Frontend

A production-minded chat UI for an **AI digital twin**: a persona-backed assistant that talks like you, remembers the conversation, and runs on a serverless AWS stack.

From Next.js static export through Terraform-provisioned CloudFront, API Gateway, Lambda, S3, and Amazon Bedrock.

---

## System overview

This UI is the edge of a full serverless stack — not a standalone demo page.

| Layer | Role |
| --- | --- |
| **UI** | Session-aware chat client (Next.js + TypeScript + Tailwind) |
| **API** | FastAPI on AWS Lambda behind API Gateway |
| **LLM** | Amazon Bedrock (Nova) — no model credentials in the browser |
| **Memory** | Per-session conversation history in a private S3 bucket |
| **Delivery** | Static export → S3 → CloudFront (HTTPS, global edge) |
| **IaC** | Environments via Terraform workspaces (`dev` / `test` / `prod`) |

The browser never talks to Bedrock directly. It only calls `/chat`; infrastructure and IAM stay on AWS.

---

## Features

- Streaming-feel chat UX with user / assistant turns and loading state
- Stable `session_id` so history survives across messages
- `NEXT_PUBLIC_API_URL` wired at deploy time from Terraform outputs
- Static export (`output: 'export'`) ready for S3 + CloudFront
- CORS-safe against the CloudFront origin configured in Lambda

---

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript**
- **Tailwind CSS 4** · **lucide-react**
- Talks to a **Python FastAPI** backend on **AWS Lambda**
- Deployed with **Terraform** + shell scripts under `/scripts` and `/terraform`

---

## Quick start (local)

```bash
# From repo root — start the API first (see /backend)
cd frontend
cp .env.example .env.local   # if present, or create one:
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL of the twin API (local or API Gateway) |

No AWS credentials or model keys belong in the frontend.

---

## Production deploy

From the repo root (requires AWS CLI + Terraform + Docker for the Lambda package):

```bash
./scripts/deploy.sh test    # or: dev | prod
```

That script:

1. Builds the Lambda zip  
2. Applies Terraform for the workspace  
3. Writes `NEXT_PUBLIC_API_URL` from the API Gateway output  
4. Runs `npm run build` and syncs `out/` to the frontend S3 bucket  

Destroy with `./scripts/destroy.sh <environment>`.

---

## Architecture (frontend’s place in the system)

```text
Browser (this app)
    │  HTTPS
    ▼
CloudFront ──► S3 (static Next export)
    │
    │  POST /chat
    ▼
API Gateway ──► Lambda (FastAPI + Mangum)
                    │
                    ├── Amazon Bedrock (LLM)
                    └── S3 (conversation memory)
```

CloudFront is intentional: HTTPS, custom-domain ready, edge caching, and a clean public URL — better than exposing the raw S3 website endpoint.

---

## Design choices

- **Static Next.js export** into an S3 + CloudFront pipeline (no Node server in prod)
- **Public UI / private LLM boundary** — Bedrock and IAM never reach the browser
- **Deploy-time config** — `NEXT_PUBLIC_API_URL` comes from Terraform outputs
- **Session-backed chat** — UX matches stateful memory on the API
- **Multi-environment** — `dev` / `test` / `prod` via Terraform workspaces

---

## Project layout

```text
frontend/
  app/                 # App Router pages
  components/twin.tsx  # Chat client + API integration
  public/              # Static assets
terraform/             # AWS infrastructure (sibling)
scripts/               # deploy.sh / destroy.sh (sibling)
backend/               # FastAPI + Lambda handler (sibling)
```

Clone it, swap the persona data under `backend/data`, and deploy your own twin.
