import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import sql, { initDatabase } from './db';
import { userRoutes } from './users';
import { rideRoutes } from './rides';
import { driverRoutes } from "./drivers.ts";

// Initialize database
await initDatabase();
console.log('✅ Database connected successfully');

const clients = new Set<any>();

// Broadcast helper for WebSocket
function broadcastToClients(message: string) {
    console.log('📡 Broadcasting to WebSocket clients:', message);
    for (const client of clients) {
        if (client.readyState === 1) { // 1 = OPEN
            client.send(message);
        }
    }
}

// Main Elysia app
const app = new Elysia()
    .use(cors())
    .decorate('db', sql) // ✅ This makes db available in all route handlers!

    // 👇 Include route modules (order matters - decorate before routes)
    .use(userRoutes)
    .use(rideRoutes)
    .use(driverRoutes)

    // Health check endpoint
    .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

    // Test database endpoint
    .get('/test-db', async ({ db }) => {
        try {
            const result = await db`SELECT NOW() as time`;
            return { success: true, time: result[0]!.time, message: 'Database is working!' };
        } catch (error: any) {
            return { success: false, error: error?.message || 'Unknown error' };
        }
    })

    // 👇 WebSocket endpoint
    .ws('/ws', {
        open(ws) {
            clients.add(ws);
            console.log('🔌 WebSocket connected. Total:', clients.size);
        },
        close(ws) {
            clients.delete(ws);
            console.log('❌ WebSocket disconnected. Total:', clients.size);
        },
        message(ws, message) {
            console.log('📨 WS received:', message);

            try {
                let parsed;
                if (typeof message === 'string') {
                    parsed = JSON.parse(message);
                } else if (typeof message === 'object') {
                    parsed = message;
                } else {
                    throw new Error('Unexpected message format');
                }

                if (parsed.type === 'locationUpdate') {
                    // Broadcast to all connected clients
                    broadcastToClients(JSON.stringify(parsed));
                }
            } catch (err) {
                console.error('❗ Invalid message format:', err);
            }
        }
    })
    .listen(3001);

console.log(`✅ Elysia is running at http://localhost:3001`);
console.log(`🏥 Health check: http://localhost:3001/health`);
console.log(`🧪 Database test: http://localhost:3001/test-db`);
console.log('🚀 Server ready!');