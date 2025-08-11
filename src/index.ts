import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { createClient } from 'redis';
import { userRoutes } from './users';
import { rideRoutes } from './rides';
import { driverRoutes } from './drivers';

// Setup Redis
const redis = createClient({ url: Bun.env.REDIS_URL || 'redis://localhost:6379' });
const redisSub = createClient({ url: Bun.env.REDIS_URL || 'redis://localhost:6379' });
await redis.connect();
await redisSub.connect();

const CHANNEL = 'rides';

// Enhanced WebSocket client tracking
interface WSClient {
    ws: WebSocket;
    subscribedRides: Set<string>;
    userId?: string;
    driverId?: string;
    type: 'passenger' | 'driver' | 'unknown';
}

const clients = new Map<WebSocket, WSClient>();

// Subscribe to Redis pub/sub
await redisSub.subscribe(CHANNEL, (message) => {
    console.log('📡 Redis -> WebSocket broadcast:', message);

    try {
        const data = JSON.parse(message);

        // Broadcast to all clients or specific ride subscribers
        for (const [ws, client] of clients.entries()) {
            if (ws.readyState === WebSocket.OPEN) {
                // If message has a rideId, only send to subscribers of that ride
                if (data.rideId) {
                    if (client.subscribedRides.has(data.rideId)) {
                        ws.send(message);
                    }
                } else {
                    // Broadcast to all connected clients
                    ws.send(message);
                }
            }
        }
    } catch (error) {
        console.error('Error broadcasting message:', error);
    }
});

// Main Elysia app
const app = new Elysia()
    .use(cors())

    // Health check
    .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

    // Include route modules
    .use(userRoutes)
    .use(rideRoutes)
    .use(driverRoutes)

    // Enhanced WebSocket endpoint
    .ws('/ws', {
        open(ws) {
            const client: WSClient = {
                ws,
                subscribedRides: new Set(),
                type: 'unknown'
            };
            clients.set(ws, client);
            console.log('🔌 WebSocket connected. Total clients:', clients.size);

            // Send connection confirmation
            ws.send(JSON.stringify({
                type: 'connected',
                message: 'WebSocket connection established'
            }));
        },

        close(ws) {
            const client = clients.get(ws);
            if (client) {
                console.log(`❌ WebSocket disconnected (${client.type}). Subscribed rides:`,
                    Array.from(client.subscribedRides));
            }
            clients.delete(ws);
            console.log('Total clients remaining:', clients.size);
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

                const client = clients.get(ws);
                if (!client) return;

                // Handle different message types
                switch (parsed.type) {
                    case 'subscribeToRide':
                        if (parsed.rideId) {
                            client.subscribedRides.add(parsed.rideId);
                            console.log(`✅ Client subscribed to ride: ${parsed.rideId}`);

                            // Send current ride status
                            redis.get(`ride:${parsed.rideId}`).then(rideData => {
                                if (rideData) {
                                    const ride = JSON.parse(rideData);
                                    ws.send(JSON.stringify({
                                        type: 'rideStatus',
                                        rideId: parsed.rideId,
                                        status: ride.status,
                                        driver: ride.driverId ? {
                                            id: ride.driverId,
                                            name: ride.driverName,
                                            vehicle: ride.driverVehicle
                                        } : null
                                    }));

                                    // Send current driver location if available
                                    redis.get(`ride:${parsed.rideId}:current-location`).then(locData => {
                                        if (locData) {
                                            ws.send(JSON.stringify({
                                                type: 'driverLocationUpdate',
                                                rideId: parsed.rideId,
                                                location: JSON.parse(locData)
                                            }));
                                        }
                                    });
                                }
                            });
                        }
                        break;

                    case 'unsubscribeFromRide':
                        if (parsed.rideId) {
                            client.subscribedRides.delete(parsed.rideId);
                            console.log(`❌ Client unsubscribed from ride: ${parsed.rideId}`);
                        }
                        break;

                    case 'identifyUser':
                        client.userId = parsed.userId;
                        client.type = 'passenger';
                        console.log(`👤 User identified: ${parsed.userId}`);
                        break;

                    case 'identifyDriver':
                        client.driverId = parsed.driverId;
                        client.type = 'driver';
                        console.log(`🚗 Driver identified: ${parsed.driverId}`);
                        break;

                    case 'driverLocationUpdate':
                        // Driver sending their location update
                        if (parsed.rideId && parsed.location) {
                            // Publish to Redis for persistence and broadcasting
                            redis.publish(CHANNEL, JSON.stringify({
                                type: 'driverLocationUpdate',
                                rideId: parsed.rideId,
                                driverId: client.driverId || parsed.driverId,
                                location: parsed.location
                            }));

                            // Also update via HTTP endpoint for persistence
                            fetch(`http://localhost:3001/api/rides/${parsed.rideId}/driver-location`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(parsed.location)
                            }).catch(err => console.error('Failed to persist location:', err));
                        }
                        break;

                    default:
                        console.log('Unknown message type:', parsed.type);
                }

            } catch (err) {
                console.error('❗ Error processing message:', err);
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Invalid message format'
                }));
            }
        }
    })
    .get('/api/ws/stats', () => {
        const stats = {
            totalConnections: clients.size,
            connections: Array.from(clients.entries()).map(([ws, client]) => ({
                type: client.type,
                subscribedRides: Array.from(client.subscribedRides),
                userId: client.userId,
                driverId: client.driverId
            }))
        };
        return stats;
    })

    .listen(3001);

console.log(`🚀 Elysia server running at http://localhost:3001`);
console.log(`📡 WebSocket endpoint: ws://localhost:3001/ws`);
console.log(`🏥 Health check: http://localhost:3001/health`);
console.log(`📊 WebSocket stats: http://localhost:3001/api/ws/stats`);