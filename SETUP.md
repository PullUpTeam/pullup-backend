# Quick Setup Guide

## Option 1: Use Neon (Recommended - Free & Fast)

1. Go to [neon.tech](https://neon.tech)
2. Sign up (free)
3. Create a new project
4. Copy the connection string
5. Update `.env`:
   ```env
   DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```
6. Run: `bun run dev`

## Option 2: Use Supabase (Free)

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Go to Settings > Database
4. Copy the "Connection string" (URI format)
5. Update `.env` with the connection string
6. Run: `bun run dev`

## Option 3: Install PostgreSQL Locally

**macOS:**
```bash
brew install postgresql@16
brew services start postgresql@16
createdb pullup
```

**Update `.env`:**
```env
DATABASE_URL="postgres://localhost:5432/pullup"
```

**Run:**
```bash
bun run dev
```

## Verify Setup

Once running, test these endpoints:
- http://localhost:3001/health
- http://localhost:3001/test-db

You should see successful responses!
