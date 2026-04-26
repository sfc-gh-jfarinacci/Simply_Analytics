<h1 align="center">Simply Analytics</h1>

<p align="center">
  An open-source analytics platform for Snowflake with drag-and-drop dashboards, 20+ visualization types, AI-powered natural language analytics, published query endpoints, a consumption analytics dashboard, and enterprise security — all deployable through a guided web-based setup wizard.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#docker-deployment">Docker</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#testing">Testing</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Snowflake-Powered-00d4ff?style=flat-square&logo=snowflake" />
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square" />
</p>

---

## Features

### Dashboards
- **20+ visualization types** — vertical bar, horizontal bar, diverging bar, line, area, pie, donut, scatter, heatmap, treemap, icicle, sankey, funnel, waterfall, radar, histogram, box plot, choropleth map, hexbin map, gauge, metric cards, data tables
- **Drag-and-drop widget editor** with field shelves, aggregation controls, filters, sorts, and calculated fields
- **Adaptive and fixed layouts** with multi-tab support and customizable canvas colors
- **Real-time data refresh** from Snowflake
- **Global dashboard filters** with cross-widget filtering
- **Export** — PNG chart export and CSV data download

### AskAI — Natural Language Analytics
- **Conversational analytics** — ask questions in plain language and get instant charts, tables, and dashboards
- **Semantic View analysis** — structured SQL generation via the Cortex Analyst REST API
- **Workspaces** — scoped environments with configured Snowflake connections and semantic views
- **Group-based access control** on workspaces
- **Persistent conversations** with encrypted message storage (AES-256-GCM)
- **Rich artifacts** — interactive charts, data tables, and multi-widget dashboard layouts generated from natural language
- **Shareable dashboards** — public share links for AI-generated dashboard artifacts
- **Export** — conversation PDF export, chart PNG export, data CSV download
- **Sample questions** — configurable per semantic view for guided exploration

### Dashboard AI Copilot
- **In-editor AI assistant** — contextual side panel with multi-provider LLM support (Cortex REST, OpenAI, Anthropic, Bedrock, Vertex, Azure)
- **Widget-aware** — focus on a specific widget for targeted modifications
- **Suggestion chips** from semantic view dimensions, measures, and facts
- **Undo stack** with revert capabilities for AI-applied changes

### Published Query Endpoints
- **Query-as-API** — publish semantic view queries as REST endpoints with parameterized inputs
- **Workspace-scoped API keys** — bearer token authentication for external consumers
- **Public and private** sharing with unique share tokens

### Consumption Dashboard
- **Admin-only analytics** — visual dashboard tracking platform usage (owner and admin roles)
- **KPI cards** — total requests, active users, login success rate, dashboard views
- **Time-series charts** — sign-in activity, request volume by type (AI / query / dashboard), active users over time
- **Popular dashboards** — leaderboard ranked by views
- **Workspace filtering** — view metrics for all workspaces or drill into a specific one
- **Date range selector** — 7-day, 30-day, and 90-day windows
- **Event tracking** — lightweight, fire-and-forget event logging across login, dashboard, query, and AI routes

### Snowflake Integration
- Direct integration with **Snowflake Semantic Views** for governed data access
- **Cortex Analyst REST API** — natural language to SQL via semantic views
- **Cortex REST API** — chat completions for AI copilot and dashboard generation
- Multiple authentication methods: PAT, key pair
- Connection pooling, role/warehouse switching

### AI Model Management
- **Multi-provider LLM abstraction** — Cortex REST, OpenAI, Anthropic, AWS Bedrock, GCP Vertex AI, Azure OpenAI
- **Platform model catalog** — define which models the platform supports with multi-cloud endpoint routing
- **Workspace AI config** — per-workspace provider and model selection with encrypted API keys
- **Health monitoring** — endpoint health checks, latency tracking, and priority-based failover

### Enterprise Security
- **Multi-factor authentication** — TOTP (Google Authenticator, Authy) and FIDO2 Passkeys (WebAuthn)
- **SAML 2.0 SSO** — Okta, Microsoft Entra ID, or any SAML IdP
- **SCIM 2.0** — automated user and group provisioning
- **RBAC** — Owner, Admin, Editor, Viewer roles with group-based dashboard and workspace access
- AES-256-GCM credential encryption at rest with key rotation
- Rate limiting, account lockout, audit logging, Helmet security headers
- Session timeout with inactivity tracking and single-session enforcement

### Web-Based Setup & Administration
- **Guided setup wizard** — configure database, security keys, run migrations, and create the owner account entirely through the browser
- **Encrypted configuration** — server config stored in AES-256-GCM encrypted file with a one-time master key
- **Emergency access** — master key login when the database is unreachable
- **Database migration wizard** — migrate all data to a new PostgreSQL instance with verification
- **Key rotation** — rotate JWT secrets and encryption keys from the admin UI
- **System monitoring** — uptime, memory usage, active sessions, and server health at a glance

### Metadata Backend
- **PostgreSQL** (recommended) or **Snowflake** as the metadata store
- Full migration scripts for both backends with SSE-streamed progress logs
- **Auto-patching** — new tables and columns applied automatically on startup

---

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or a Snowflake account for metadata)
- A Snowflake account with Semantic Views

### Install

```bash
git clone https://github.com/jfarinacci/Simply-Analytics.git
cd Simply-Analytics
npm run install:all
```

### Option A: Web-Based Setup (Recommended)

Start the application without any configuration — the setup wizard handles everything:

```bash
npm run dev
```

1. Open http://localhost:5173
2. Sign in with the bootstrap credentials: `admin` / `admin123`
3. Follow the guided wizard:
   - **Database** — choose PostgreSQL or Snowflake and enter connection details
   - **Security** — review auto-generated JWT and encryption keys
   - **Migrations** — schema creation runs automatically
   - **Owner** — create your permanent owner account
4. Save the master encryption key when prompted — it won't be shown again
5. Sign in with your new owner account

### Option B: Manual Configuration

Create `server/.env` with the required variables (see [Configuration](#configuration) below):

```env
NODE_ENV=development
PORT=3001

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=your_user
POSTGRES_PASSWORD=your_password
POSTGRES_DB=simply_analytics

# Auth (generate strong random values)
JWT_SECRET=your-secret-min-32-characters-long
JWT_EXPIRY=8h
CREDENTIALS_ENCRYPTION_KEY=your-encryption-key-32-chars

# CORS
CORS_ORIGINS=http://localhost:5173
```

Run migrations and start:

```bash
cd server && node src/db/migrate-postgres.js
cd .. && npm run dev
```

This creates all tables and a default admin user (`admin` / `admin123`).

### Access

- **Frontend** → http://localhost:5173
- **API** → http://localhost:3001

> Change the default admin password immediately after first login.

---

## Docker Deployment

```bash
docker compose up -d
```

This starts two services:

| Service | Port | Description |
|---------|------|-------------|
| `api` | 3001 | Express API server with encrypted config volume |
| `client` | 80 | Nginx serving the React SPA + API proxy |

The database is **not** bundled — provide your own PostgreSQL or Snowflake instance and configure it through the setup wizard on first launch. Server configuration is persisted in a Docker volume (`config-data`) and encrypted with a master key generated on first launch.

---

## Configuration

### Encrypted Config Store

When using the web-based setup wizard, all configuration is stored in an AES-256-GCM encrypted file (`data/config.json`). The master encryption key is:

1. Read from the `MASTER_KEY` environment variable, or
2. Read from a file at `MASTER_KEY_PATH`, or
3. Auto-generated and stored at `data/.master-key`

The master key is shown once during setup. Store it securely for emergency access.

### Environment Variables (Manual Mode)

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | `development` or `production` | `development` |
| `PORT` | API server port | `3001` |
| `POSTGRES_HOST` | PostgreSQL host | `localhost` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_USER` | PostgreSQL username | — |
| `POSTGRES_PASSWORD` | PostgreSQL password | — |
| `POSTGRES_DB` | PostgreSQL database | — |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | — |
| `JWT_EXPIRY` | Token expiry duration | `8h` |
| `CREDENTIALS_ENCRYPTION_KEY` | AES-256 key for credential encryption | — |
| `CORS_ORIGINS` | Comma-separated allowed origins | — |
| `METADATA_BACKEND` | `postgres` or `snowflake` | `postgres` |
| `SESSION_TIMEOUT_MINUTES` | Inactivity timeout | `20` |

### SSO (Optional)

```env
SSO_ENABLED=true
SAML_ENTRYPOINT=https://your-idp.example.com/sso/saml
SAML_ISSUER=simply-analytics
SAML_CALLBACK_URL=https://your-app.example.com/api/v1/saml/callback
SAML_CERT=<Base64 IdP signing certificate>
```

### SCIM Provisioning (Optional)

```env
SCIM_ENABLED=true
SCIM_BEARER_TOKEN=your-scim-token
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       React 18 + Vite                            │
│  Dashboard Builder · Widget Editor · AskAI · Consumption · Admin │
│  D3.js · ECharts · AG Grid · TanStack · GridStack · @dnd-kit    │
└──────────────────────────────┬───────────────────────────────────┘
                               │ REST + JWT + SSE
┌──────────────────────────────┴───────────────────────────────────┐
│                      Express API Server                          │
│  Auth · SAML SSO · SCIM · MFA · Dashboard · Ask · Consumption   │
│  Workspaces · Endpoints · Platform Models · Event Tracking       │
│  Encrypted Config Store · Helmet · Rate Limit                    │
└──────────────┬─────────────────────────────────┬─────────────────┘
               │                                 │
         PostgreSQL                       Snowflake SDK
               │                                 │
┌──────────────┴─────────────────┐  ┌────────────┴────────────────┐
│   Metadata + Config            │  │   Snowflake Data Cloud      │
│   Users · Dashboards · Ask     │  │   Semantic Views            │
│   Workspaces · Endpoints       │  │   Cortex Analyst REST API   │
│   App Events · Audit Log       │  │   Cortex REST API           │
│   Encrypted Credentials        │  │   Queries · AI Insights     │
└────────────────────────────────┘  └─────────────────────────────┘
```

### Project Structure

```
simply-analytics/
├── client/                     # React SPA
│   ├── src/
│   │   ├── api/                # API client modules (17 modules)
│   │   ├── components/
│   │   │   ├── ai/             # Dashboard AI copilot
│   │   │   ├── ask/            # Simply Ask chat components & renderers
│   │   │   ├── charts/         # 20+ visualization types (D3.js + ECharts)
│   │   │   ├── dashboard-browser/ # Folder & dashboard browsing
│   │   │   ├── dashboard-settings-modal/ # Dashboard settings & access
│   │   │   ├── dashboard-view/ # Dashboard layout, tabs & hooks
│   │   │   ├── dashboard-widget/ # Widget rendering & menus
│   │   │   ├── shared/         # Reusable UI components
│   │   │   ├── widget-editor/  # Drag-and-drop widget editor
│   │   │   └── users-management/ # User & group management
│   │   ├── store/              # Zustand state management (10 slices)
│   │   ├── utils/              # Export utilities (PNG, CSV, PDF)
│   │   └── views/              # Page-level components (9 views)
│   ├── Dockerfile
│   └── nginx.conf
├── server/                     # Express API
│   ├── src/
│   │   ├── config/             # Encrypted config store & hot reload
│   │   ├── db/                 # PostgreSQL + Snowflake backends
│   │   ├── middleware/         # Auth, rate limiting, session management
│   │   ├── routes/             # API endpoints (19 route files)
│   │   ├── services/           # Business logic (24 services)
│   │   └── utils/              # Encryption, query builder
│   └── Dockerfile
├── tests/                      # Vitest unit & integration tests
├── e2e/                        # Playwright end-to-end tests
├── docker-compose.yml
├── playwright.config.js
└── package.json                # Workspace root
```

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, Vite, Zustand, D3.js, ECharts, AG Grid, TanStack Table/Virtual, GridStack, @dnd-kit, React Router 7, html-to-image, jsPDF |
| **Backend** | Express, PostgreSQL, Snowflake SDK |
| **AI** | Snowflake Cortex Analyst REST API, Cortex REST API, OpenAI, Anthropic, AWS Bedrock, GCP Vertex AI, Azure OpenAI |
| **Auth** | JWT, bcrypt, SAML 2.0, SCIM 2.0, TOTP, WebAuthn/FIDO2 |
| **Security** | AES-256-GCM (credentials + config + messages), Helmet, express-rate-limit |
| **Testing** | Vitest, Playwright, supertest |
| **Infra** | Docker, Nginx |

---

## User Roles

| Role | Dashboards | AskAI | Connections | Users | Consumption | Admin |
|------|-----------|-------|-------------|-------|-------------|-------|
| **Owner** | Full access | Full access + manage workspaces | Manage | Manage all | Full access | Full admin |
| **Admin** | Create & edit | Access via workspace groups | Manage | Manage | Full access | — |
| **Editor** | Create & edit | Access via workspace groups | View | — | — | — |
| **Viewer** | View only | Access via workspace groups | — | — | — | — |

---

## API Routes

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/auth/login` | Authenticate (password) |
| `POST /api/v1/auth/emergency-login` | Master key emergency access |
| `GET/POST /api/v1/2fa/*` | TOTP and Passkey management |
| `GET /api/v1/saml/login` | Initiate SAML SSO |
| `POST /api/v1/saml/callback` | SAML assertion callback |
| `/scim/v2/Users`, `/scim/v2/Groups` | SCIM 2.0 provisioning |
| `GET/POST/PUT/DELETE /api/v1/dashboard/*` | Dashboard CRUD |
| `POST /api/v1/query/execute` | Execute Snowflake queries |
| `GET /api/v1/semantic/*` | Semantic view discovery |
| `GET/POST/PUT/DELETE /api/v1/users/*` | User management |
| `GET/POST/PUT/DELETE /api/v1/connections/*` | Connection management |
| `GET/POST/PUT/DELETE /api/v1/groups/*` | Group management |
| `GET/POST/PUT/DELETE /api/v1/folders/*` | Folder management |
| `GET/POST/PUT/DELETE /api/v1/workspaces/*` | Workspace management |
| `GET/POST/DELETE /api/v1/workspaces/:id/endpoints/*` | Published query endpoints |
| `GET/POST/DELETE /api/v1/workspaces/:id/api-keys/*` | Workspace API keys |
| `GET /api/v1/pipe/:token` | Public query endpoint execution |
| `POST /api/v1/ask/message` | AskAI conversation via Cortex Analyst (SSE) |
| `GET/POST/DELETE /api/v1/ask/conversations/*` | Conversation management |
| `POST /api/v1/ask/dashboards` | Save AI-generated dashboard |
| `GET /api/v1/ask/shared/dashboard/:token` | Public shared dashboard |
| `POST /api/v1/dashboard-ai/generate` | AI dashboard generation |
| `POST /api/v1/dashboard-ai/generate-widget` | AI widget generation |
| `POST /api/v1/dashboard-ai/chat` | Dashboard AI copilot (SSE) |
| `GET /api/v1/consumption/overview` | Consumption KPI summary |
| `GET /api/v1/consumption/auth-metrics` | Sign-in success/fail over time |
| `GET /api/v1/consumption/popular-dashboards` | Dashboard popularity leaderboard |
| `GET /api/v1/consumption/request-volume` | Requests by type over time |
| `GET /api/v1/consumption/active-users` | Active user counts over time |
| `GET/POST /api/v1/platform/*` | Platform model catalog management |
| `GET/PUT /api/v1/admin/config` | Admin configuration |
| `POST /api/v1/admin/migrate` | Schema migrations (SSE) |
| `POST /api/v1/admin/migrate-data` | Data migration (SSE) |
| `POST /api/v1/admin/rotate-key/:type` | Key rotation (jwt/encryption) |
| `GET /api/v1/admin/system` | System health info |
| `GET/POST /api/v1/setup/*` | Initial setup wizard |

---

## Testing

Simply Analytics includes unit, integration, and end-to-end tests.

### Unit & Integration Tests

```bash
# Run all tests
npm test

# Server tests only
npm run test:server

# Client tests only
npm run test:client
```

Tests use [Vitest](https://vitest.dev/) with jsdom for client component tests and [supertest](https://github.com/ladjs/supertest) for server API tests.

### End-to-End Tests

```bash
# Install Playwright browsers (first time)
npx playwright install

# Run E2E tests
npm run test:e2e
```

E2E tests use [Playwright](https://playwright.dev/) and automatically start the dev server.

---

## Troubleshooting

**PostgreSQL permissions:**
```sql
GRANT ALL PRIVILEGES ON DATABASE simply_analytics TO your_user;
```

**Port conflict:**
```bash
lsof -ti:3001 | xargs kill -9
```

**Snowflake network policy errors:**
Ensure your IP is allowlisted or connect through VPN, then use the Reconnect button.

**Lost master key:**
If you lose the master encryption key, delete `data/config.json` and `data/.master-key`, then re-run the setup wizard. All configuration will need to be re-entered.

**Emergency database access:**
If the database is unreachable, use the master key to sign in via the emergency login flow. Update your database credentials from the admin panel, then sign out and back in normally.

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create your branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

[Apache 2.0](LICENSE.md) — Jorge Farinacci
