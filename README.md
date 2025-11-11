# Pull-Up Backend

Bun + Elysia + PostgreSQL backend for the Pull-Up ride-sharing app.

## Setup

### 1. Install PostgreSQL

**macOS (Homebrew):**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Or use a hosted service:**
- [Neon](https://neon.tech) - Serverless Postgres (free tier)
- [Supabase](https://supabase.com) - Postgres + more (free tier)
- [Railway](https://railway.app) - Easy deployment (free tier)

### 2. Create Database

```bash
# Local PostgreSQL
createdb pullup

# Or connect to your hosted database and it will auto-create tables
```

### 3. Configure Environment

Update `.env` with your database URL:

```env
# Local
DATABASE_URL="postgres://localhost:5432/pullup"

# Or hosted (example)
DATABASE_URL="postgres://user:password@host:5432/database"
```

### 4. Install Dependencies

```bash
bun install
```

### 5. Run Development Server

```bash
bun run dev
```

The server will:
- Auto-create database tables on startup
- Run on `http://localhost:3001`
- Enable hot reload

## API Endpoints

### Health Check
- `GET /health` - Server status
- `GET /test-db` - Database connection test

### Users
- `POST /api/users/check` - Check if user exists
- `POST /api/users/create` - Create new user
- `PUT /api/users/update` - Update user
- `GET /api/users/:id` - Get user by ID
- `GET /api/users/email/:email` - Get user by email
- `GET /api/users` - Get all users
- `DELETE /api/users/:id` - Delete user

### Drivers
- `POST /api/drivers/check` - Check if driver exists
- `POST /api/drivers/apply` - Submit driver application
- `PUT /api/drivers/update` - Update driver info
- `GET /api/drivers/:id` - Get driver by ID
- `PUT /api/drivers/availability` - Update availability
- `GET /api/drivers/availability/:status` - Get drivers by status
- `GET /api/drivers/:id/location` - Get driver location
- `PUT /api/drivers/:id/location` - Update driver location
- `POST /api/drivers/approve/:id` - Approve driver
- `POST /api/drivers/reject/:id` - Reject driver
- `DELETE /api/drivers/:id` - Delete driver

### Rides
- `POST /api/rides/create` - Create new ride
- `GET /api/rides/:id` - Get ride by ID
- `GET /api/rides/user/:userId` - Get user's rides
- `GET /api/rides` - Get all rides (paginated)
- `PUT /api/rides/:id/status` - Update ride status
- `PUT /api/rides/:id/assign-driver` - Assign driver to ride
- `GET /api/rides/:id/driver` - Get assigned driver
- `DELETE /api/rides/:id` - Delete ride

### WebSocket
- `WS /ws` - Real-time location updates

## Migration from Redis

This project was migrated from Redis to PostgreSQL for:
- Better data persistence
- Relational queries
- Easier local development
- Free hosted options

All Redis operations have been converted to SQL queries with proper indexing for performance.
