import { Elysia } from 'elysia';
import { v4 as uuidv4 } from 'uuid';
import type { Ride, Coordinates } from './types';

export const rideRoutes = new Elysia({ prefix: '/api/rides' })
    // Create new ride
    .post('/create', async ({ body, redis }: {
        body: {
            userId: string;
            userEmail: string;
            walletAddress: string;
            originCoordinates: Coordinates;
            destinationCoordinates: Coordinates;
            originAddress: string;
            destinationAddress: string;
            estimatedPrice?: string;
            customPrice?: string;
            scheduledTime?: string;
            notes?: string;
        };
        redis: any;
    }) => {
        try {
            const {
                userId,
                userEmail,
                walletAddress,
                originCoordinates,
                destinationCoordinates,
                originAddress,
                destinationAddress,
                estimatedPrice,
                customPrice,
            } = body;

            // Validate required fields
            if (!userId || !userEmail || !originCoordinates || !destinationCoordinates || !originAddress || !destinationAddress) {
                return {
                    error: 'Missing required fields: userId, userEmail, originCoordinates, destinationCoordinates, originAddress, destinationAddress',
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
                walletAddress,
                originCoordinates,
                destinationCoordinates,
                originAddress,
                destinationAddress,
                estimatedPrice,
                customPrice,
                status: 'pending',
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
    .get('/:id', async ({ params, redis }: { params: { id: string }; redis: any }) => {
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
    .get('/user/:userId', async ({ params, redis }: { params: { userId: string }; redis: any }) => {
        try {
            const { userId } = params;

            // Get ride IDs for the user
            const rideIds = await redis.sMembers(`user:rides:${userId}`);

            if (rideIds.length === 0) {
                return { rides: [] };
            }

            // Get ride data for each ID
            const rides = await Promise.all(
                rideIds.map(async (rideId: string) => {
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
    .get('/', async ({ query, redis }: { query: { limit?: string; offset?: string; status?: string }; redis: any }) => {
        try {
            const offset = parseInt(query.offset || '0');
            const statusFilter = query.status;

            // Get ride IDs from sorted set (newest first)
            const rideIds = await redis.zRange('rides:all', offset, offset - 1, { REV: true });

            if (rideIds.length === 0) {
                return { rides: [], total: 0 };
            }

            // Get ride data for each ID
            const rides = await Promise.all(
                rideIds.map(async (rideId: string) => {
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
    .put('/:id/status', async ({ params, body, redis }: {
        params: { id: string };
        body: { status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' };
        redis: any;
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
    .delete('/:id', async ({ params, redis }: { params: { id: string }; redis: any }) => {
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
    });