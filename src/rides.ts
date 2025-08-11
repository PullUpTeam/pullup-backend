// rides.ts - Fixed with consistent route parameters
import { Elysia } from 'elysia';
import { v4 as uuidv4 } from 'uuid';
import type { Ride, Coordinates, Driver } from './types';

export const rideRoutes = new Elysia({ prefix: '/api/rides' })
    // Create new ride
    .post('/create', async ({ body, redis }: {
        body: {
            userId: string;
            userEmail: string;
            walletAddress?: string;
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

            // Add to pending rides set for driver matching
            await redis.sAdd('rides:pending', rideId);

            // Publish ride creation event
            await redis.publish('rides', JSON.stringify({
                type: 'rideCreated',
                ride: newRide
            }));

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

    // Get all rides (for admin purposes - with pagination)
    // Note: This route MUST come before parameterized routes
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

    // Get rides by user ID
    // Note: This specific route comes before the generic :rideId route
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

    // Get ride by ID - Using :rideId for consistency
    .get('/:rideId', async ({ params, redis }: { params: { rideId: string }; redis: any }) => {
        try {
            const { rideId } = params;

            const rideData = await redis.get(`ride:${rideId}`);

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

    // Assign driver to ride
    .post('/:rideId/assign-driver', async ({ params, body, redis }: {
        params: { rideId: string };
        body: { driverId: string };
        redis: any;
    }) => {
        try {
            const { rideId } = params;
            const { driverId } = body;

            // Get ride data
            const rideData = await redis.get(`ride:${rideId}`);
            if (!rideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride: Ride = JSON.parse(rideData);

            // Check if ride is still pending
            if (ride.status !== 'pending') {
                return {
                    error: 'Ride is no longer available',
                    status: 400,
                };
            }

            // Get driver data
            const driverData = await redis.get(`driver:id:${driverId}`);
            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: Driver = JSON.parse(driverData);

            // Check if driver is available
            if (driver.availability !== 'online_free') {
                return {
                    error: 'Driver is not available',
                    status: 400,
                };
            }

            // Update ride with driver info
            const updatedRide: Ride = {
                ...ride,
                driverId,
                driverName: driver.fullName,
                driverVehicle: `${driver.vehicleModel} (${driver.vehiclePlate})`,
                driverPhone: driver.phoneNumber,
                driverLocation: {
                    latitude: driver.latitude || 0,
                    longitude: driver.longitude || 0
                },
                status: 'accepted',
                acceptedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Update driver status to busy
            const updatedDriver: Driver = {
                ...driver,
                availability: 'online_busy',
                currentRideId: rideId,
                updatedAt: new Date().toISOString()
            };

            // Save updates
            await redis.set(`ride:${rideId}`, JSON.stringify(updatedRide));
            await redis.set(`driver:id:${driverId}`, JSON.stringify(updatedDriver));
            await redis.set(`driver:${driver.email}`, JSON.stringify(updatedDriver));

            // Update availability sets
            await redis.sRem('rides:pending', rideId);
            await redis.sAdd('rides:accepted', rideId);
            await redis.sRem('drivers:online_free', driverId);
            await redis.sAdd('drivers:online_busy', driverId);

            // Publish assignment event
            await redis.publish('rides', JSON.stringify({
                type: 'driverAssigned',
                rideId,
                driverId,
                driver: {
                    id: driverId,
                    name: driver.fullName,
                    vehicle: `${driver.vehicleModel} (${driver.vehiclePlate})`,
                    phone: driver.phoneNumber,
                    location: {
                        latitude: driver.latitude || 0,
                        longitude: driver.longitude || 0
                    }
                }
            }));

            return {
                success: true,
                ride: updatedRide,
                message: 'Driver assigned successfully'
            };

        } catch (error) {
            console.error('Error assigning driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Update driver location for a ride
    .post('/:rideId/driver-location', async ({ params, body, redis }: {
        params: { rideId: string };
        body: {
            latitude: number;
            longitude: number;
            heading?: number;
            speed?: number;
        };
        redis: any;
    }) => {
        try {
            const { rideId } = params;
            const { latitude, longitude, heading, speed } = body;

            // Validate coordinates
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                return {
                    error: 'Invalid location data',
                    status: 400,
                };
            }

            // Get ride data
            const rideData = await redis.get(`ride:${rideId}`);
            if (!rideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride: Ride = JSON.parse(rideData);

            // Check if ride has a driver
            if (!ride.driverId) {
                return {
                    error: 'No driver assigned to this ride',
                    status: 400,
                };
            }

            // Update driver location in driver record
            const driverData = await redis.get(`driver:id:${ride.driverId}`);
            if (driverData) {
                const driver: Driver = JSON.parse(driverData);
                const updatedDriver: Driver = {
                    ...driver,
                    latitude,
                    longitude,
                    heading,
                    speed,
                    lastLocationUpdate: new Date().toISOString()
                };
                await redis.set(`driver:id:${ride.driverId}`, JSON.stringify(updatedDriver));
                await redis.set(`driver:${driver.email}`, JSON.stringify(updatedDriver));
            }

            // Store location update in ride tracking
            const locationUpdate = {
                latitude,
                longitude,
                heading,
                speed,
                timestamp: new Date().toISOString()
            };

            // Store in a time-series like structure for tracking history
            await redis.zAdd(`ride:${rideId}:locations`, {
                score: Date.now(),
                value: JSON.stringify(locationUpdate)
            });

            // Store current location for quick access
            await redis.set(`ride:${rideId}:current-location`, JSON.stringify(locationUpdate));

            // Publish location update via WebSocket
            await redis.publish('rides', JSON.stringify({
                type: 'driverLocationUpdate',
                rideId,
                driverId: ride.driverId,
                location: locationUpdate
            }));

            return {
                success: true,
                message: 'Location updated',
                location: locationUpdate
            };

        } catch (error) {
            console.error('Error updating driver location:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get ride tracking info (including driver location)
    .get('/:rideId/tracking', async ({ params, redis }: { params: { rideId: string }; redis: any }) => {
        try {
            const { rideId } = params;

            // Get ride data
            const rideData = await redis.get(`ride:${rideId}`);
            if (!rideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride: Ride = JSON.parse(rideData);

            // Get current driver location
            let currentLocation = null;
            const locationData = await redis.get(`ride:${rideId}:current-location`);
            if (locationData) {
                currentLocation = JSON.parse(locationData);
            } else if (ride.driverId) {
                // Fallback to driver's stored location
                const driverData = await redis.get(`driver:id:${ride.driverId}`);
                if (driverData) {
                    const driver: Driver = JSON.parse(driverData);
                    currentLocation = {
                        latitude: driver.latitude,
                        longitude: driver.longitude,
                        timestamp: driver.lastLocationUpdate
                    };
                }
            }

            // Get location history (last 50 points)
            const locationHistory = await redis.zRange(`ride:${rideId}:locations`, -50, -1);
            const parsedHistory = locationHistory.map((loc: string) => JSON.parse(loc));

            return {
                ride: {
                    id: ride.id,
                    status: ride.status,
                    origin: ride.originCoordinates,
                    destination: ride.destinationCoordinates,
                    originAddress: ride.originAddress,
                    destinationAddress: ride.destinationAddress,
                    driver: ride.driverId ? {
                        id: ride.driverId,
                        name: ride.driverName,
                        vehicle: ride.driverVehicle,
                        phone: ride.driverPhone
                    } : null
                },
                currentLocation,
                locationHistory: parsedHistory,
                lastUpdate: currentLocation?.timestamp || null
            };

        } catch (error) {
            console.error('Error fetching tracking info:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Find and assign nearest available driver
    .post('/:rideId/auto-assign', async ({ params, redis }: { params: { rideId: string }; redis: any }) => {
        try {
            const { rideId } = params;

            // Get ride data
            const rideData = await redis.get(`ride:${rideId}`);
            if (!rideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride: Ride = JSON.parse(rideData);

            // Get available drivers
            const availableDriverIds = await redis.sMembers('drivers:online_free');

            if (availableDriverIds.length === 0) {
                return {
                    error: 'No available drivers',
                    status: 404,
                };
            }

            // Get driver details and calculate distances
            const driversWithDistance = await Promise.all(
                availableDriverIds.map(async (driverId: string) => {
                    const driverData = await redis.get(`driver:id:${driverId}`);
                    if (!driverData) return null;

                    const driver: Driver = JSON.parse(driverData);
                    if (!driver.latitude || !driver.longitude) return null;

                    // Calculate distance using Haversine formula
                    const R = 6371; // Earth's radius in km
                    const dLat = (driver.latitude - ride.originCoordinates.latitude) * Math.PI / 180;
                    const dLng = (driver.longitude - ride.originCoordinates.longitude) * Math.PI / 180;
                    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                        Math.cos(ride.originCoordinates.latitude * Math.PI / 180) *
                        Math.cos(driver.latitude * Math.PI / 180) *
                        Math.sin(dLng/2) * Math.sin(dLng/2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    const distance = R * c;

                    return { driver, distance };
                })
            );

            // Filter out null values and sort by distance
            const validDrivers = driversWithDistance
                .filter(Boolean)
                .sort((a, b) => a!.distance - b!.distance);

            if (validDrivers.length === 0) {
                return {
                    error: 'No drivers with valid location data',
                    status: 404,
                };
            }

            // Assign the nearest driver
            const nearestDriver = validDrivers[0]!.driver;
            const driverId = nearestDriver.id;

            // Perform the assignment directly here
            const updatedRide: Ride = {
                ...ride,
                driverId,
                driverName: nearestDriver.fullName,
                driverVehicle: `${nearestDriver.vehicleModel} (${nearestDriver.vehiclePlate})`,
                driverPhone: nearestDriver.phoneNumber,
                driverLocation: {
                    latitude: nearestDriver.latitude || 0,
                    longitude: nearestDriver.longitude || 0
                },
                status: 'accepted',
                acceptedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const updatedDriver: Driver = {
                ...nearestDriver,
                availability: 'online_busy',
                currentRideId: rideId,
                updatedAt: new Date().toISOString()
            };

            // Save updates
            await redis.set(`ride:${rideId}`, JSON.stringify(updatedRide));
            await redis.set(`driver:id:${driverId}`, JSON.stringify(updatedDriver));
            await redis.set(`driver:${nearestDriver.email}`, JSON.stringify(updatedDriver));

            // Update availability sets
            await redis.sRem('rides:pending', rideId);
            await redis.sAdd('rides:accepted', rideId);
            await redis.sRem('drivers:online_free', driverId);
            await redis.sAdd('drivers:online_busy', driverId);

            // Publish assignment event
            await redis.publish('rides', JSON.stringify({
                type: 'driverAssigned',
                rideId,
                driverId,
                driver: {
                    id: driverId,
                    name: nearestDriver.fullName,
                    vehicle: `${nearestDriver.vehicleModel} (${nearestDriver.vehiclePlate})`,
                    phone: nearestDriver.phoneNumber,
                    location: {
                        latitude: nearestDriver.latitude || 0,
                        longitude: nearestDriver.longitude || 0
                    }
                }
            }));

            return {
                success: true,
                assignedDriver: {
                    id: nearestDriver.id,
                    name: nearestDriver.fullName,
                    distance: validDrivers[0]!.distance
                }
            };

        } catch (error) {
            console.error('Error auto-assigning driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Update ride status - Using :rideId for consistency
    .put('/:rideId/status', async ({ params, body, redis }: {
        params: { rideId: string };
        body: { status: 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' };
        redis: any;
    }) => {
        try {
            const { rideId } = params;
            const { status } = body;

            if (!status || !['pending', 'accepted', 'in_progress', 'completed', 'cancelled'].includes(status)) {
                return {
                    error: 'Invalid status. Must be one of: pending, accepted, in_progress, completed, cancelled',
                    status: 400,
                };
            }

            // Get existing ride
            const existingRideData = await redis.get(`ride:${rideId}`);
            if (!existingRideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const existingRide: Ride = JSON.parse(existingRideData);

            // Update ride with appropriate timestamp
            const updatedRide: Ride = {
                ...existingRide,
                status,
                updatedAt: new Date().toISOString(),
                ...(status === 'in_progress' && !existingRide.startedAt ? { startedAt: new Date().toISOString() } : {}),
                ...(status === 'completed' && !existingRide.completedAt ? { completedAt: new Date().toISOString() } : {}),
                ...(status === 'cancelled' && !existingRide.cancelledAt ? { cancelledAt: new Date().toISOString() } : {})
            };

            // Update in Redis
            const rideJson = JSON.stringify(updatedRide);
            await redis.set(`ride:${rideId}`, rideJson);

            // Publish status update event
            await redis.publish('rides', JSON.stringify({
                type: 'rideStatusUpdate',
                rideId,
                status
            }));

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

    // Delete ride - Using :rideId for consistency
    .delete('/:rideId', async ({ params, redis }: { params: { rideId: string }; redis: any }) => {
        try {
            const { rideId } = params;

            // Get ride first to find user ID
            const rideData = await redis.get(`ride:${rideId}`);

            if (!rideData) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride: Ride = JSON.parse(rideData);

            // Delete ride data
            await redis.del(`ride:${rideId}`);

            // Remove from user rides set
            await redis.sRem(`user:rides:${ride.userId}`, rideId);

            // Remove from all rides sorted set
            await redis.zRem('rides:all', rideId);

            // Remove from status sets
            await redis.sRem('rides:pending', rideId);
            await redis.sRem('rides:accepted', rideId);

            // Delete location tracking data
            await redis.del(`ride:${rideId}:current-location`);
            await redis.del(`ride:${rideId}:locations`);

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