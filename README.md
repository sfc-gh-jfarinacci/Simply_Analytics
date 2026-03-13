<h1 align="center">Simply Analytics</h1>

<p align="center">
  An open-source analytics platform for Snowflake with drag-and-drop dashboards, 25+ visualization types, and enterprise security.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#docker-deployment">Docker</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Snowflake-Powered-00d4ff?style=flat-square&logo=snowflake" />
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
</p>

---

## Features

### Dashboards
- **25+ visualization types** — bar, line, area, pie, donut, scatter, bubble, heatmap, treemap, sunburst, sankey, funnel, icicle, radar, histogram, boxplot, violin, choropleth, bubble map, metric cards, data tables, pivot tables
- **Drag-and-drop widget editor** with field shelves, aggregation controls, filters, sorts, and calculated fields
- **Adaptive and fixed layouts** with multi-tab support
- **Real-time data refresh** from Snowflake

### Snowflake Integration
- Direct integration with **Snowflake Semantic Views**
- Multiple authentication methods: PAT, key pair, OAuth
- Connection pooling, role/warehouse switching
- **Cortex AI** — natural language data explanations powered by Snowflake Cortex COMPLETE

### Enterprise Security
- **Multi-factor authentication** — TOTP (Google Authenticator, Authy) and FIDO2 Passkeys (WebAuthn)
- **SAML 2.0 SSO** — Okta, Microsoft Entra ID, or any SAML IdP
- **SCIM 2.0** — automated user and group provisioning
- **RBAC** — Owner, Admin, Editor, Viewer roles with group-based dashboard access
- AES-256-GCM credential encryption at rest with key rotation
- Rate limiting, account lockout, audit logging, Helmet security headers
- Single-session enforcement with Redis-backed distributed sessions

### Metadata Backend
- **PostgreSQL** (recommended) or **Snowflake** as the metadata store
- Full migration scripts for both backends

---

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- A Snowflake account with Semantic Views

### Install

```bash
git clone https://github.com/jfarinacci/Simply-Analytics.git
cd Simply-Analytics
npm run install:all
```

### Configure

Create `server/.env`:

```env
NODE_ENV=development
PORT=3001

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=your_user
POSTGRES_PASSWORD=your_password
POSTGRES_DATABASE=simply_analytics

# Auth (generate strong random values)
JWT_SECRET=your-secret-min-32-characters-long
JWT_EXPIRY=8h
CREDENTIALS_ENCRYPTION_KEY=your-encryption-key-32-chars

# CORS
CORS_ORIGINS=http://localhost:5173
```

### Migrate

```bash
cd server
node src/db/migrate-postgres.js
```

This creates all tables and a default admin user (`admin` / `admin123`).

### Run

```bash
npm run dev
```

- **API** → http://localhost:3001
- **Frontend** → http://localhost:5173

> Change the default admin password immediately after first login.

---

## Docker Deployment

```bash
docker compose up -d
```

This starts four services:

| Service | Port | Description |
|---------|------|-------------|
| `postgres` | 5432 | Metadata storage |
| `redis` | 6379 | Session storage |
| `api` | 3001 | Express API server |
| `client` | 80 | Nginx serving the React SPA + API proxy |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | `development` or `production` | `development` |
| `PORT` | API server port | `3001` |
| `POSTGRES_HOST` | PostgreSQL host | `localhost` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_USER` | PostgreSQL username | — |
| `POSTGRES_PASSWORD` | PostgreSQL password | — |
| `POSTGRES_DATABASE` | PostgreSQL database | — |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | — |
| `JWT_EXPIRY` | Token expiry duration | `8h` |
| `CREDENTIALS_ENCRYPTION_KEY` | AES-256 key for credential encryption | — |
| `CORS_ORIGINS` | Comma-separated allowed origins | — |
| `METADATA_BACKEND` | `postgres` or `snowflake` | `postgres` |

### SSO (Optional)

```env
SSO_ENABLED=true
SAML_ENTRY_POINT=https://your-idp.example.com/sso/saml
SAML_ISSUER=simply-analytics
SAML_CALLBACK_URL=https://your-app.example.com/api/saml/callback
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
┌────────────────────────────────────────────────────────┐
│                   React 18 + Vite                      │
│  Dashboard Builder · Widget Editor · Admin Console     │
│  D3.js · ECharts · AG Grid · GridStack · @dnd-kit     │
└──────────────────────────┬─────────────────────────────┘
                           │ REST + JWT
┌──────────────────────────┴─────────────────────────────┐
│                Express API Server                      │
│  Auth · SAML SSO · SCIM · MFA · Dashboard · Query     │
│  Helmet · Rate Limiting · Audit Log                    │
└───────────┬──────────────────────────────┬─────────────┘
            │                              │
   PostgreSQL / Redis               Snowflake SDK
            │                              │
┌───────────┴───────────┐   ┌──────────────┴─────────────┐
│  Metadata + Sessions  │   │   Snowflake Data Cloud     │
│  Users · Dashboards   │   │   Semantic Views · Cortex  │
│  Connections · Groups │   │   Queries · AI Insights    │
└───────────────────────┘   └────────────────────────────┘
```

### Project Structure

```
simply-analytics/
├── client/                  # React SPA
│   ├── src/
│   │   ├── api/             # API client
│   │   ├── components/      # UI components
│   │   │   ├── charts/      # 25+ visualization types
│   │   │   └── widget-editor/ # Drag-and-drop editor
│   │   ├── store/           # Zustand state management
│   │   └── styles/          # Global styles + themes
│   ├── Dockerfile
│   └── nginx.conf
├── server/                  # Express API
│   ├── src/
│   │   ├── db/              # PostgreSQL + Snowflake backends
│   │   ├── middleware/      # Auth, rate limiting
│   │   ├── routes/          # API endpoints
│   │   ├── services/        # Business logic
│   │   └── scripts/         # Key rotation utilities
│   └── Dockerfile
├── docker-compose.yml
└── package.json             # Workspace root
```

### Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, Vite, Zustand, D3.js, ECharts, AG Grid, GridStack, @dnd-kit |
| **Backend** | Express, PostgreSQL, Snowflake SDK, Redis |
| **Auth** | JWT, bcrypt, SAML 2.0, SCIM 2.0, TOTP, WebAuthn/FIDO2 |
| **Security** | AES-256-GCM, Helmet, express-rate-limit |
| **Infra** | Docker, Nginx |

---

## User Roles

| Role | Dashboards | Connections | Users | Groups |
|------|-----------|-------------|-------|--------|
| **Owner** | Full access | Manage | Manage all | Manage |
| **Admin** | Create & edit | Manage | Manage | Manage |
| **Editor** | Create & edit | View | — | — |
| **Viewer** | View only | — | — | — |

---

## API Routes

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/login` | Authenticate (password, PAT, keypair) |
| `GET /api/auth/roles` | List available Snowflake roles |
| `GET/POST /api/2fa/*` | TOTP and Passkey management |
| `GET /api/saml/login` | Initiate SAML SSO |
| `POST /api/saml/callback` | SAML assertion callback |
| `/scim/v2/Users`, `/scim/v2/Groups` | SCIM 2.0 provisioning |
| `GET/POST/PUT/DELETE /api/dashboard/*` | Dashboard CRUD |
| `POST /api/query/execute` | Execute Snowflake queries |
| `GET /api/semantic/*` | Semantic view discovery |
| `GET/POST/PUT/DELETE /api/users/*` | User management |
| `GET/POST/PUT/DELETE /api/connections/*` | Connection management |
| `GET/POST/PUT/DELETE /api/groups/*` | Group management |
| `GET/POST/PUT/DELETE /api/folders/*` | Folder management |

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

**Encryption key rotation:**
```bash
cd server
node src/scripts/rotate-encryption-key.js
```

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

[Apache 2.0 Lic](LICENSE.md) — Jorge Farinacci
