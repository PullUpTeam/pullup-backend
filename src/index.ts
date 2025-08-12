import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { createClient } from 'redis';
import { userRoutes } from './users';
import { rideRoutes } from './rides';
import { driverRoutes } from "./drivers.ts";

// Setup Redis
const redis = createClient({ url: Bun.env.REDIS_URL || 'redis://localhost:6379' });
const redisSub = createClient({ url: Bun.env.REDIS_URL || 'redis://localhost:6379' });
await redis.connect();
await redisSub.connect();

// Test Redis connection
console.log('✅ Redis connected successfully');

const CHANNEL = 'rides';
const clients = new Set<WebSocket>();

await redisSub.subscribe(CHANNEL, (message) => {
    console.log('📡 Redis -> WebSocket:', message);
    for (const client of clients) {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    }
});

// Main Elysia app
const app = new Elysia()
    .use(cors())
    .decorate('redis', redis) // ✅ This makes redis available in all route handlers!

    // 👇 Include route modules (order matters - decorate before routes)
    .use(userRoutes)
    .use(rideRoutes)
    .use(driverRoutes)

    // Health check endpoint
    .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

    // Test Redis endpoint
    .get('/test-redis', async ({ redis }) => {
        try {
            await redis.set('test-key', 'test-value');
            const value = await redis.get('test-key');
            return { success: true, value, message: 'Redis is working!' };
        } catch (error) {
            return { success: false, error: error.message };
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
                    redis.publish(CHANNEL, JSON.stringify(parsed));
                }
            } catch (err) {
                console.error('❗ Invalid message format:', err);
            }
        }
    })
    .listen(3001);

console.log(`✅ Elysia is running at http://localhost:3001`);
console.log(`🏥 Health check: http://localhost:3001/health`);
console.log(`🧪 Redis test: http://localhost:3001/test-redis`);
console.log('🚀 Server ready!');