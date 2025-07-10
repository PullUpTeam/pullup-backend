import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';

// Types
export interface User {
    id: string;
    email: string;
    username: string;
    walletAddress?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Coordinates {
    latitude: number;
    longitude: number;
}

export interface Ride {
    id: string;
    userId: string;
    userEmail: string;
    originCoordinates: Coordinates;
    destinationCoordinates: Coordinates;
    originAddress: string;
    destinationAddress: string;
    rideType: string;
    estimatedPrice?: string;
    customPrice?: string;
    status: 'pending' | 'auctioning' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
    scheduledTime?: string;
    notes?: string;
    createdAt: string;
    updatedAt: string;
}

// Initialize Redis client with better error handling
const redis = createClient({
    url: process.env.REDIS_URL
});

// Connect to Redis
await redis.connect();


const app = new Elysia()
    .use(cors())
    .get('/health', async () => {
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

    // ==================== USER ENDPOINTS ====================

    // Check if user exists
    .post('/api/users/check', async ({ body }: { body: { email: string } }) => {
        try {
            const { email } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Check if user exists
            const userData = await redis.get(`user:${email}`);

            if (userData) {
                const existingUser: User = JSON.parse(userData);
                return {
                    exists: true,
                    user: existingUser
                };
            }

            return {
                exists: false
            };

        } catch (error) {
            console.error('Error checking user:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Create new user
    .post('/api/users/create', async ({ body }: { body: { email: string; walletAddress?: string; username?: string } }) => {
        try {
            const { email, walletAddress, username } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Check if user already exists
            const existingUserData = await redis.get(`user:${email}`);
            if (existingUserData) {
                return {
                    error: 'User already exists',
                    status: 400,
                };
            }

            // Create new user
            const userId = uuidv4();
            const finalUsername = username || createUsernameFromEmail(email);
            const now = new Date().toISOString();

            const newUser: User = {
                id: userId,
                email,
                username: finalUsername,
                walletAddress,
                createdAt: now,
                updatedAt: now,
            };

            // Store user in Redis
            const userJson = JSON.stringify(newUser);
            await redis.set(`user:${email}`, userJson);

            // Also store by ID for quick lookups
            await redis.set(`user:id:${userId}`, userJson);

            return {
                success: true,
                user: newUser
            };

        } catch (error) {
            console.error('Error creating user:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Update user
    .put('/api/users/update', async ({ body }: { body: { email: string; walletAddress?: string; username?: string } }) => {
        try {
            const { email, walletAddress, username } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Get existing user
            const existingUserData = await redis.get(`user:${email}`);
            if (!existingUserData) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            const existingUser: User = JSON.parse(existingUserData);

            // Update user
            const updatedUser: User = {
                ...existingUser,
                ...(walletAddress && { walletAddress }),
                ...(username && { username }),
                updatedAt: new Date().toISOString(),
            };

            // Update in Redis
            const userJson = JSON.stringify(updatedUser);
            await redis.set(`user:${email}`, userJson);
            await redis.set(`user:id:${existingUser.id}`, userJson);

            return {
                success: true,
                user: updatedUser
            };

        } catch (error) {
            console.error('Error updating user:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get user by ID
    .get('/api/users/:id', async ({ params }: { params: { id: string } }) => {
        try {
            const { id } = params;

            const userData = await redis.get(`user:id:${id}`);

            if (!userData) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            const user: User = JSON.parse(userData);
            return { user };

        } catch (error) {
            console.error('Error fetching user:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get user by email
    .get('/api/users/email/:email', async ({ params }: { params: { email: string } }) => {
        try {
            const { email } = params;

            const userData = await redis.get(`user:${decodeURIComponent(email)}`);

            if (!userData) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            const user: User = JSON.parse(userData);
            return { user };

        } catch (error) {
            console.error('Error fetching user:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get all users (for admin purposes - consider adding auth)
    .get('/api/users', async () => {
        try {
            // This is a simple implementation - in production, you'd want pagination
            // and proper admin authentication
            const keys = await redis.keys('user:*');
            const emailKeys = keys.filter(key => !key.includes('user:id:'));

            const users = await Promise.all(
                emailKeys.map(async (key) => {
                    const userData = await redis.get(key);
                    return userData ? JSON.parse(userData) : null;
                })
            );

            return { users: users.filter(Boolean) };

        } catch (error) {
            console.error('Error fetching users:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Delete user
    .delete('/api/users/:id', async ({ params }: { params: { id: string } }) => {
        try {
            const { id } = params;

            // Get user first to find email
            const userData = await redis.get(`user:id:${id}`);

            if (!userData) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            const user: User = JSON.parse(userData);

            // Delete both keys
            await redis.del(`user:${user.email}`);
            await redis.del(`user:id:${id}`);

            return {
                success: true,
                message: 'User deleted successfully'
            };

        } catch (error) {
            console.error('Error deleting user:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // ==================== RIDE ENDPOINTS ====================

    // Create new ride
    .post('/api/rides/create', async ({ body }: {
        body: {
            userId: string;
            userEmail: string;
            originCoordinates: Coordinates;
            destinationCoordinates: Coordinates;
            originAddress: string;
            destinationAddress: string;
            rideType: string;
            estimatedPrice?: string;
            customPrice?: string;
            scheduledTime?: string;
            notes?: string;
        }
    }) => {
        try {
            const {
                userId,
                userEmail,
                originCoordinates,
                destinationCoordinates,
                originAddress,
                destinationAddress,
                rideType,
                estimatedPrice,
                customPrice,
                scheduledTime,
                notes
            } = body;

            // Validate required fields
            if (!userId || !userEmail || !originCoordinates || !destinationCoordinates || !originAddress || !destinationAddress || !rideType) {
                return {
                    error: 'Missing required fields: userId, userEmail, originCoordinates, destinationCoordinates, originAddress, destinationAddress, rideType',
                    status: 400,
                };
            }

            // Validate coordinates
            if (typeof originCoordinates.latitude !== 'number' || typeof originCoordinates.longitude !== 'number' ||
                typeof destinationCoordinates.latitude !== 'number' || typeof destinationCoordinates.longitude !== 'number') {
                return {
                    error: 'Invalid coordinates format',
                    status: 400,
                };
            }

            // Create new ride
            const rideId = uuidv4();
            const now = new Date().toISOString();

            const newRide: Ride = {
                id: rideId,
                userId,
                userEmail,
                originCoordinates,
                destinationCoordinates,
                originAddress,
                destinationAddress,
                rideType,
                estimatedPrice,
                customPrice,
                status: 'pending',
                scheduledTime,
                notes,
                createdAt: now,
                updatedAt: now,
            };

            // Store ride in Redis
            const rideJson = JSON.stringify(newRide);
            await redis.set(`ride:${rideId}`, rideJson);

            // Store by user ID for quick user ride lookups
            await redis.sAdd(`user:rides:${userId}`, rideId);

            // Store in a sorted set by creation time for chronological queries
            await redis.zAdd('rides:all', { score: Date.now(), value: rideId });

            return {
                success: true,
                ride: newRide
            };

        } catch (error) {
            console.error('Error creating ride:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get ride by ID
    .get('/api/rides/:id', async ({ params }: { params: { id: string } }) => {
        try {
            const { id } = params;

            const rideData = await redis.get(`ride:${id}`);

            if (!rideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride: Ride = JSON.parse(rideData);
            return { ride };

        } catch (error) {
            console.error('Error fetching ride:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get rides by user ID
    .get('/api/rides/user/:userId', async ({ params }: { params: { userId: string } }) => {
        try {
            const { userId } = params;

            // Get ride IDs for the user
            const rideIds = await redis.sMembers(`user:rides:${userId}`);

            if (rideIds.length === 0) {
                return { rides: [] };
            }

            // Get ride data for each ID
            const rides = await Promise.all(
                rideIds.map(async (rideId) => {
                    const rideData = await redis.get(`ride:${rideId}`);
                    return rideData ? JSON.parse(rideData) : null;
                })
            );

            // Filter out null values and sort by creation time (newest first)
            const validRides = rides.filter(Boolean).sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );

            return { rides: validRides };

        } catch (error) {
            console.error('Error fetching user rides:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get all rides (for admin purposes - with pagination)
    .get('/api/rides', async ({ query }: { query: { limit?: string; offset?: string; status?: string } }) => {
        try {
            const limit = parseInt(query.limit || '50');
            const offset = parseInt(query.offset || '0');
            const statusFilter = query.status;

            // Get ride IDs from sorted set (newest first)
            const rideIds = await redis.zRange('rides:all', offset, offset + limit - 1, { REV: true });

            if (rideIds.length === 0) {
                return { rides: [], total: 0 };
            }

            // Get ride data for each ID
            const rides = await Promise.all(
                rideIds.map(async (rideId) => {
                    const rideData = await redis.get(`ride:${rideId}`);
                    return rideData ? JSON.parse(rideData) : null;
                })
            );

            let validRides = rides.filter(Boolean);

            // Apply status filter if provided
            if (statusFilter) {
                validRides = validRides.filter(ride => ride.status === statusFilter);
            }

            // Get total count
            const totalCount = await redis.zCard('rides:all');

            return {
                rides: validRides,
                total: totalCount,
                limit,
                offset
            };

        } catch (error) {
            console.error('Error fetching rides:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Update ride status
    .put('/api/rides/:id/status', async ({ params, body }: {
        params: { id: string };
        body: { status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' };
    }) => {
        try {
            const { id } = params;
            const { status } = body;

            if (!status || !['pending', 'accepted', 'in_progress', 'completed', 'cancelled'].includes(status)) {
                return {
                    error: 'Invalid status. Must be one of: pending, accepted, in_progress, completed, cancelled',
                    status: 400,
                };
            }

            // Get existing ride
            const existingRideData = await redis.get(`ride:${id}`);
            if (!existingRideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const existingRide: Ride = JSON.parse(existingRideData);

            // Update ride
            const updatedRide: Ride = {
                ...existingRide,
                status,
                updatedAt: new Date().toISOString(),
            };

            // Update in Redis
            const rideJson = JSON.stringify(updatedRide);
            await redis.set(`ride:${id}`, rideJson);

            return {
                success: true,
                ride: updatedRide
            };

        } catch (error) {
            console.error('Error updating ride status:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Delete ride
    .delete('/api/rides/:id', async ({ params }: { params: { id: string } }) => {
        try {
            const { id } = params;

            // Get ride first to find user ID
            const rideData = await redis.get(`ride:${id}`);

            if (!rideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride: Ride = JSON.parse(rideData);

            // Delete ride data
            await redis.del(`ride:${id}`);

            // Remove from user rides set
            await redis.sRem(`user:rides:${ride.userId}`, id);

            // Remove from all rides sorted set
            await redis.zRem('rides:all', id);

            return {
                success: true,
                message: 'Ride deleted successfully'
            };

        } catch (error) {
            console.error('Error deleting ride:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    .listen(3001);

console.log(`Elysia is running at http://localhost:3001`);
console.log(`Health check: http://localhost:3001/health`);

export default app;