import postgres from 'postgres';

// PostgreSQL connection
const sql = postgres(Bun.env.DATABASE_URL || 'postgres://localhost:5432/pullup', {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
});

// Initialize database schema
export async function initDatabase() {
    await sql`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            wallet_address TEXT,
            is_driver BOOLEAN DEFAULT FALSE,
            driver_id TEXT,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
    `;

    await sql`
        CREATE TABLE IF NOT EXISTS drivers (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone_number TEXT NOT NULL,
            address TEXT NOT NULL,
            license_number TEXT UNIQUE NOT NULL,
            vehicle_model TEXT NOT NULL,
            vehicle_year TEXT NOT NULL,
            vehicle_plate TEXT UNIQUE NOT NULL,
            motivation TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            availability TEXT NOT NULL DEFAULT 'offline',
            current_ride_id TEXT,
            last_location_update TIMESTAMPTZ,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            application_date TIMESTAMPTZ NOT NULL,
            approval_date TIMESTAMPTZ,
            rejection_reason TEXT,
            username TEXT,
            wallet_address TEXT,
            is_driver BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
    `;

    await sql`
        CREATE TABLE IF NOT EXISTS rides (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            user_email TEXT NOT NULL,
            wallet_address TEXT NOT NULL,
            origin_lat DOUBLE PRECISION NOT NULL,
            origin_lng DOUBLE PRECISION NOT NULL,
            destination_lat DOUBLE PRECISION NOT NULL,
            destination_lng DOUBLE PRECISION NOT NULL,
            origin_address TEXT NOT NULL,
            destination_address TEXT NOT NULL,
            estimated_price TEXT,
            custom_price TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            assigned_driver_id TEXT,
            driver_accepted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL
        )
    `;

    await sql`
        CREATE TABLE IF NOT EXISTS driver_locations (
            driver_id TEXT PRIMARY KEY,
            latitude DOUBLE PRECISION NOT NULL,
            longitude DOUBLE PRECISION NOT NULL,
            heading DOUBLE PRECISION,
            speed DOUBLE PRECISION,
            accuracy DOUBLE PRECISION,
            timestamp TIMESTAMPTZ NOT NULL
        )
    `;

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_drivers_email ON drivers(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_drivers_availability ON drivers(availability)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rides_user_id ON rides(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rides_assigned_driver ON rides(assigned_driver_id)`;

    console.log('✅ Database schema initialized');
}

export default sql;
