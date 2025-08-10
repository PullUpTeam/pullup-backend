import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { createClient } from 'redis';
import { userRoutes } from './users';
import { rideRoutes } from './rides';
import {driverRoutes} from "./drivers.ts";

// Initialize Redis client with better error handling
const redis = createClient({
    url: process.env.REDIS_URL
});

// Connect to Redis
await redis.connect();

const app = new Elysia()
    .use(cors())
    .decorate('redis', redis)
    .get('/health', async ({ redis }) => {
        try {
            // Check Redis connection
            await redis.ping();
            return {
                status: 'OK',
                timestamp: new Date().toISOString(),
                redis: 'connected',
            };
        } catch (error) {
            return {
                status: 'ERROR',
                timestamp: new Date().toISOString(),
                redis: 'disconnected',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    })
    .use(userRoutes)
    .use(rideRoutes)
    .use(driverRoutes)
    .listen(3001);

console.log(`Elysia is running at http://localhost:3001`);
console.log(`Health check: http://localhost:3001/health`);

export default app;