# Simply Analytics

A modern analytics platform for Snowflake with drag-and-drop dashboards, semantic views, user management, and Cortex AI integration. Built entirely in JavaScript.

![Simply Analytics](https://img.shields.io/badge/Snowflake-Analytics-00d4ff?style=for-the-badge)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Metadata-336791?style=for-the-badge)

## Features

### 🔐 User Management
- PostgreSQL-based user authentication
- Role-based access control (Owner, Admin, Editor, Viewer)
- User groups for dashboard sharing
- Single-session enforcement
- JWT-based session management with 8-hour expiry

### 🔌 Snowflake Integration
- Multiple connection configurations per user
- PAT token and Key Pair authentication
- Connection pooling and caching
- Role and warehouse switching
- Network policy error handling with reconnect

### 📊 Semantic Views
- Direct integration with Snowflake Semantic Views
- Auto-discovery of dimensions and measures
- Calculated fields with SQL expressions
- Filter and sort capabilities

### 📈 Drag & Drop Dashboards
- 25+ visualization types including:
  - **Charts** - Bar, Line, Area, Pie, Donut, Scatter, Bubble
  - **Advanced** - Heatmap, Treemap, Sunburst, Sankey, Radar
  - **Statistical** - Histogram, Boxplot, Violin
  - **Geographic** - Choropleth, Bubble Map
  - **Data** - Tables, Pivot Tables, Metric Cards
- Adaptive and fixed layout modes
- Multi-tab dashboards
- Real-time data refresh
- YAML-based configuration

### 🤖 Cortex AI Integration
- "Explain" feature for AI-powered data insights
- Natural language data interpretation
- Powered by Snowflake Cortex COMPLETE

### 🎨 Modern UI
- Light and dark themes with smooth transitions
- Responsive design
- Beautiful data visualizations with D3.js

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      React Frontend                          │
│  ┌─────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Auth   │  │    User      │  │   Dashboard Builder    │  │
│  │  Login  │  │  Settings    │  │  (Drag & Drop Widgets) │  │
│  └─────────┘  └──────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                     REST API + JWT
                            │
┌─────────────────────────────────────────────────────────────┐
│                    Express API Server                        │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │    Auth    │  │  Users   │  │ Semantic │  │Dashboard │  │
│  │   Routes   │  │  Routes  │  │  Routes  │  │  Routes  │  │
│  └────────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
              │                              │
     PostgreSQL (Metadata)           Snowflake SDK
              │                              │
┌─────────────────────────┐    ┌─────────────────────────────┐
│   PostgreSQL Database   │    │     Snowflake Data Cloud    │
│  - Users & Groups       │    │  - Semantic Views           │
│  - Connections          │    │  - Data Queries             │
│  - Dashboard Configs    │    │  - Cortex AI                │
└─────────────────────────┘    └─────────────────────────────┘
```

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- A Snowflake account with Semantic Views

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository>
cd simply-analytics
npm run install:all
```

2. **Set up PostgreSQL:**

Create a PostgreSQL database:
```sql
CREATE DATABASE simply_analytics;
```

3. **Configure environment variables:**

Create a `.env` file in the `server` directory:
```env
# Server
NODE_ENV=development
PORT=3001
VERBOSE_LOGS=false

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=your_postgres_user
POSTGRES_PASSWORD=your_postgres_password
POSTGRES_DATABASE=simply_analytics

# Authentication
JWT_SECRET=your_jwt_secret_here_min_32_chars
JWT_EXPIRY=8h
SESSION_TIMEOUT_MINUTES=480
CREDENTIALS_ENCRYPTION_KEY=your_encryption_key_here_32_chars

# CORS (adjust for your frontend URL)
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

4. **Run database migrations:**
```bash
cd server
node src/db/migrate-postgres.js
```

This creates:
- Users table with default admin (username: `admin`, password: `admin123`)
- User groups table
- Snowflake connections table
- Dashboards table
- Dashboard access table

5. **Start the development servers:**
```bash
npm run dev
```

This starts:
- API server at `http://localhost:3001`
- Frontend at `http://localhost:5173`

## Usage

### 1. Sign In
Use the default admin credentials or create new users:
- Username: `admin`
- Password: `admin123`

**Important:** Change the admin password after first login!

### 2. Configure Snowflake Connections
Go to Settings and add your Snowflake connection:
- Connection name
- Account identifier (e.g., `abc12345.us-east-1`)
- Username
- Authentication: PAT Token or Key Pair
- Default warehouse and role

### 3. Create Dashboards
- Click "Create Dashboard"
- Select a Snowflake connection
- Choose role and warehouse
- Select semantic views to use
- Start building with the Widget Editor

### 4. Build Widgets
- Drag dimensions and measures to chart axes
- Choose from 25+ visualization types
- Add filters and sorts
- Create calculated fields
- Use Cortex AI to explain your data

### 5. Manage Access
- Set dashboard visibility (Private/Public)
- Assign user groups for private dashboards
- Control access levels (View, Edit, Admin)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `3001` |
| `VERBOSE_LOGS` | Enable debug logging | `false` |
| `POSTGRES_HOST` | PostgreSQL host | `localhost` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_USER` | PostgreSQL username | - |
| `POSTGRES_PASSWORD` | PostgreSQL password | - |
| `POSTGRES_DATABASE` | PostgreSQL database name | - |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | - |
| `JWT_EXPIRY` | JWT token expiry | `8h` |
| `CREDENTIALS_ENCRYPTION_KEY` | AES encryption key for credentials | - |
| `CORS_ORIGINS` | Allowed CORS origins | - |

## Tech Stack

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool
- **React Router** - Client-side routing
- **Zustand** - State management
- **@dnd-kit** - Drag and drop
- **D3.js** - Data visualizations
- **React Icons** - Icon library

### Backend
- **Express** - API framework
- **PostgreSQL** - Metadata storage
- **snowflake-sdk** - Snowflake connector
- **jsonwebtoken** - JWT authentication
- **bcryptjs** - Password hashing
- **crypto-js** - Credential encryption
- **uuid** - ID generation
- **js-yaml** - YAML parsing

## Project Structure

```
simply-analytics/
├── client/                 # React frontend
│   ├── src/
│   │   ├── api/            # API client
│   │   ├── components/     # UI components
│   │   ├── store/          # Zustand state
│   │   ├── styles/         # CSS files
│   │   ├── utils/          # Utilities
│   │   ├── App.jsx         # Main app with routing
│   │   └── main.jsx        # Entry point
│   └── package.json
├── server/                 # Express backend
│   ├── src/
│   │   ├── db/             # Database connectors
│   │   │   ├── postgres.js # PostgreSQL client
│   │   │   ├── snowflake.js# Snowflake SDK
│   │   │   └── schema.sql  # Database schema
│   │   ├── middleware/     # Auth middleware
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   └── index.js        # Server entry
│   ├── env.example         # Environment template
│   └── package.json
└── package.json            # Root workspace
```

## User Roles

| Role | Permissions |
|------|-------------|
| **Owner** | Full access, transfer ownership, manage all users |
| **Admin** | Manage users and groups, create dashboards |
| **Editor** | Create and edit dashboards |
| **Viewer** | View published dashboards only |

## Security

- Passwords hashed with bcrypt
- Snowflake credentials encrypted with AES-256
- JWT tokens with 8-hour expiry
- Single-session enforcement
- Session invalidation on server restart
- Network policy error handling

## Troubleshooting

### PostgreSQL Permission Errors
Ensure your PostgreSQL user has permission to create tables:
```sql
GRANT ALL PRIVILEGES ON DATABASE simply_analytics TO your_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_user;
```

### Port Already in Use
```bash
lsof -ti:3001 | xargs kill -9
```

### Snowflake Network Policy Errors
If you see "IP not allowed" errors:
1. Connect to VPN if required
2. Click the "Reconnect" button in the dashboard toolbar

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE.md](LICENSE.md) for details.
