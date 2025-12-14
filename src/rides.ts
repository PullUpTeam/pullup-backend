import { Elysia } from 'elysia';
import { v4 as uuidv4 } from 'uuid';
import type { Ride, Coordinates } from './types';
import type { Sql } from 'postgres';

function mapRowToRide(row: any): Ride {
    return {
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email,
        walletAddress: row.wallet_address,
        originCoordinates: { latitude: row.origin_lat, longitude: row.origin_lng },
        destinationCoordinates: { latitude: row.destination_lat, longitude: row.destination_lng },
        originAddress: row.origin_address,
        destinationAddress: row.destination_address,
        estimatedPrice: row.estimated_price,
        customPrice: row.custom_price,
        distanceKm: row.distance_km,
        passengerCount: row.passenger_count ?? 1,
        requiredVehicleType: row.required_vehicle_type ?? 1,
        status: row.status,
        assignedDriverId: row.assigned_driver_id,
        driverAcceptedAt: row.driver_accepted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// Haversine formula to calculate distance between two coordinates in km
function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calculate driver's minimum price for a ride based on their preferences
function calculateDriverMinPrice(pricePerKm: number, minPricePerRide: number, distanceKm: number): number {
    const distanceBasedPrice = pricePerKm * distanceKm;
    return Math.max(distanceBasedPrice, minPricePerRide);
}

// Parse price string to number (handles "$10.50" or "10.50" formats)
function parsePriceToNumber(price: string | undefined | null): number {
    if (!price) return 0;
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
}

interface MatchingRide extends Ride {
    distanceToPickup: number;
    driverMinPrice: number;
    ridePrice: number;
    matchScore: number;
}

export const rideRoutes = new Elysia({ prefix: '/api/rides' })
    // Create new ride
    .post('/create', async ({ body, db }: {
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
        db: Sql;
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
                    error: 'Missing required fields',
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

            await db`
                INSERT INTO rides (
                    id, user_id, user_email, wallet_address,
                    origin_lat, origin_lng, destination_lat, destination_lng,
                    origin_address, destination_address,
                    estimated_price, custom_price, status,
                    created_at, updated_at
                ) VALUES (
                    ${rideId}, ${userId}, ${userEmail}, ${walletAddress},
                    ${originCoordinates.latitude}, ${originCoordinates.longitude},
                    ${destinationCoordinates.latitude}, ${destinationCoordinates.longitude},
                    ${originAddress}, ${destinationAddress},
                    ${estimatedPrice || null}, ${customPrice || null}, 'pending',
                    ${now}, ${now}
                )
            `;

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
    .get('/:id', async ({ params, db }: { params: { id: string }; db: Sql }) => {
        try {
            const { id } = params;

            const rides = await db`
                SELECT * FROM rides WHERE id = ${id}
            `;

            if (rides.length === 0) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride = mapRowToRide(rides[0]!);
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
    .get('/user/:userId', async ({ params, db }: { params: { userId: string }; db: Sql }) => {
        try {
            const { userId } = params;

            const results = await db`
                SELECT * FROM rides 
                WHERE user_id = ${userId}
                ORDER BY created_at DESC
            `;

            const rides: Ride[] = results.map(mapRowToRide);
            return { rides };

        } catch (error) {
            console.error('Error fetching user rides:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get all rides (for admin purposes - with pagination)
    .get('/', async ({ query, db }: { query: { limit?: string; offset?: string; status?: string }; db: Sql }) => {
        try {
            const limit = parseInt(query.limit || '50');
            const offset = parseInt(query.offset || '0');
            const statusFilter = query.status;

            let results;
            if (statusFilter) {
                results = await db`
                    SELECT * FROM rides 
                    WHERE status = ${statusFilter}
                    ORDER BY created_at DESC
                    LIMIT ${limit} OFFSET ${offset}
                `;
            } else {
                results = await db`
                    SELECT * FROM rides 
                    ORDER BY created_at DESC
                    LIMIT ${limit} OFFSET ${offset}
                `;
            }

            const rides: Ride[] = results.map(mapRowToRide);

            const totalResult = await db`SELECT COUNT(*) as count FROM rides`;
            const total = parseInt(totalResult[0]!.count as string);

            return {
                rides,
                total,
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
    .put('/:id/status', async ({ params, body, db }: {
        params: { id: string };
        body: { status: string };
        db: Sql;
    }) => {
        try {
            const { id } = params;
            const { status } = body;

            const validStatuses = [
                'pending', 'accepted', 'driver_assigned', 'approaching_pickup',
                'driver_arrived', 'in_progress', 'completed', 'cancelled'
            ];

            if (!status || !validStatuses.includes(status)) {
                return {
                    error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
                    status: 400,
                };
            }

            const now = new Date().toISOString();

            const result = await db`
                UPDATE rides 
                SET status = ${status}, updated_at = ${now}
                WHERE id = ${id}
                RETURNING *
            `;

            if (result.length === 0) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const updatedRide = mapRowToRide(result[0]!);
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

    // Assign driver to ride
    .put('/:id/assign-driver', async ({ params, body, db }: {
        params: { id: string };
        body: { driverId: string; status?: string };
        db: Sql;
    }) => {
        try {
            const { id } = params;
            const { driverId, status = 'driver_assigned' } = body;

            if (!driverId) {
                return {
                    error: 'Driver ID is required',
                    status: 400,
                };
            }

            // Get existing ride
            const rides = await db`
                SELECT * FROM rides WHERE id = ${id}
            `;

            if (rides.length === 0) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const existingRide = rides[0]!;

            if (!['pending', 'accepted'].includes(existingRide.status)) {
                return {
                    error: 'Ride cannot be assigned to driver in current status',
                    status: 400,
                };
            }

            // Get driver info
            const drivers = await db`
                SELECT * FROM drivers WHERE id = ${driverId}
            `;

            if (drivers.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const fullDriver = drivers[0]!;
            const now = new Date().toISOString();

            // Update ride
            const result = await db`
                UPDATE rides 
                SET 
                    assigned_driver_id = ${driverId},
                    status = ${status},
                    driver_accepted_at = ${now},
                    updated_at = ${now}
                WHERE id = ${id}
                RETURNING *
            `;

            const updatedRide = mapRowToRide(result[0]!);

            const driver = {
                id: fullDriver.id,
                email: fullDriver.email,
                username: fullDriver.full_name || fullDriver.email.split('@')[0],
                walletAddress: fullDriver.wallet_address || '',
                isDriver: fullDriver.status === 'approved',
                createdAt: fullDriver.created_at,
                updatedAt: fullDriver.updated_at,
            };

            return {
                success: true,
                ride: updatedRide,
                driver
            };

        } catch (error) {
            console.error('Error assigning driver to ride:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get assigned driver
    .get('/:id/driver', async ({ params, db }: {
        params: { id: string };
        db: Sql;
    }) => {
        try {
            const { id } = params;

            // Get ride data
            const rides = await db`
                SELECT * FROM rides WHERE id = ${id}
            `;

            if (rides.length === 0) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

            const ride = rides[0]!;

            if (!ride.assigned_driver_id) {
                return { driver: null };
            }

            // Get driver data
            const drivers = await db`
                SELECT * FROM drivers WHERE id = ${ride.assigned_driver_id}
            `;

            if (drivers.length === 0) {
                return { driver: null };
            }

            const fullDriver = drivers[0]!;
            const driver = {
                id: fullDriver.id,
                email: fullDriver.email,
                username: fullDriver.full_name || fullDriver.email.split('@')[0],
                walletAddress: fullDriver.wallet_address || '',
                isDriver: fullDriver.status === 'approved',
                createdAt: fullDriver.created_at,
                updatedAt: fullDriver.updated_at,
            };

            return { driver };

        } catch (error) {
            console.error('Error getting assigned driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get driver location
    .get('/:id/location', async ({ params, db }: {
        params: { id: string };
        db: Sql;
    }) => {
        try {
            const { id: driverId } = params;

            // Get location from driver_locations table
            const locations = await db`
                SELECT * FROM driver_locations WHERE driver_id = ${driverId}
            `;

            if (locations.length === 0) {
                // Fallback: get location from driver record
                const drivers = await db`
                    SELECT latitude, longitude, last_location_update 
                    FROM drivers 
                    WHERE id = ${driverId}
                `;

                if (drivers.length > 0 && drivers[0]!.latitude && drivers[0]!.longitude) {
                    return {
                        location: {
                            driverId,
                            latitude: drivers[0]!.latitude,
                            longitude: drivers[0]!.longitude,
                            timestamp: drivers[0]!.last_location_update || new Date().toISOString(),
                        }
                    };
                }

                return { location: null };
            }

            const loc = locations[0]!;
            return {
                location: {
                    driverId: loc.driver_id,
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                    heading: loc.heading,
                    speed: loc.speed,
                    accuracy: loc.accuracy,
                    timestamp: loc.timestamp,
                }
            };

        } catch (error) {
            console.error('Error getting driver location:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Delete ride
    .delete('/:id', async ({ params, db }: { params: { id: string }; db: Sql }) => {
        try {
            const { id } = params;

            const result = await db`
                DELETE FROM rides WHERE id = ${id} RETURNING id
            `;

            if (result.length === 0) {
                return {
                    error: 'Ride not found',
                    status: 404,
                };
            }

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

    // ============================================================
    // MATCHING ALGORITHM: Get rides matching driver's preferences
    // ============================================================
    //
    // This endpoint returns only rides that match the driver's profile:
    // 1. Within driver's max pickup radius
    // 2. Ride price >= driver's minimum price (based on pricePerKm * distance or minPricePerRide)
    // 3. Driver's vehicle type >= ride's required vehicle type
    // 4. Driver's max passengers >= ride's passenger count
    //
    // Results are sorted by match score (best matches first)
    // ============================================================
    .get('/matching/:driverId', async ({ params, query, db }: {
        params: { driverId: string };
        query: { limit?: string; sortBy?: string };
        db: Sql;
    }) => {
        try {
            const { driverId } = params;
            const limit = parseInt(query.limit || '20');
            const sortBy = query.sortBy || 'score'; // 'score', 'distance', 'price'

            // 1. Get driver with their preferences and current location
            const drivers = await db`
                SELECT
                    id, latitude, longitude, status, availability,
                    price_per_km, min_price_per_ride, max_pickup_radius_km,
                    vehicle_type, max_passengers
                FROM drivers
                WHERE id = ${driverId}
            `;

            if (drivers.length === 0) {
                return { error: 'Driver not found', status: 404 };
            }

            const driver = drivers[0]!;

            // Verify driver is approved and available
            if (driver.status !== 'approved') {
                return { error: 'Driver must be approved to view matching rides', status: 403 };
            }

            if (driver.availability !== 'online_free') {
                return { error: 'Driver must be online and free to view matching rides', status: 403 };
            }

            // Check if driver has location set
            if (!driver.latitude || !driver.longitude) {
                return { error: 'Driver location is required for matching', status: 400 };
            }

            const driverLat = driver.latitude;
            const driverLng = driver.longitude;
            const pricePerKm = driver.price_per_km ?? 1.5;
            const minPricePerRide = driver.min_price_per_ride ?? 5.0;
            const maxPickupRadius = driver.max_pickup_radius_km ?? 10.0;
            const driverVehicleType = driver.vehicle_type ?? 1;
            const driverMaxPassengers = driver.max_passengers ?? 4;

            // 2. Get all pending rides
            const pendingRides = await db`
                SELECT * FROM rides
                WHERE status = 'pending'
                AND assigned_driver_id IS NULL
                ORDER BY created_at DESC
            `;

            // 3. Filter and score rides based on driver preferences
            const matchingRides: MatchingRide[] = [];

            for (const row of pendingRides) {
                const ride = mapRowToRide(row);

                // Calculate distance from driver to pickup point
                const distanceToPickup = calculateDistanceKm(
                    driverLat, driverLng,
                    ride.originCoordinates.latitude,
                    ride.originCoordinates.longitude
                );

                // FILTER 1: Check if ride is within driver's max pickup radius
                if (distanceToPickup > maxPickupRadius) {
                    continue;
                }

                // FILTER 2: Check vehicle type requirement
                const requiredVehicleType = ride.requiredVehicleType ?? 1;
                if (driverVehicleType < requiredVehicleType) {
                    continue;
                }

                // FILTER 3: Check passenger count
                const passengerCount = ride.passengerCount ?? 1;
                if (driverMaxPassengers < passengerCount) {
                    continue;
                }

                // Calculate ride distance (origin to destination)
                const rideDistanceKm = ride.distanceKm ?? calculateDistanceKm(
                    ride.originCoordinates.latitude, ride.originCoordinates.longitude,
                    ride.destinationCoordinates.latitude, ride.destinationCoordinates.longitude
                );

                // Calculate driver's minimum acceptable price for this ride
                const driverMinPrice = calculateDriverMinPrice(pricePerKm, minPricePerRide, rideDistanceKm);

                // Get ride's offered price (customPrice takes priority over estimatedPrice)
                const ridePrice = parsePriceToNumber(ride.customPrice) || parsePriceToNumber(ride.estimatedPrice);

                // FILTER 4: Check if ride price meets driver's minimum
                if (ridePrice < driverMinPrice) {
                    continue;
                }

                // Calculate match score (higher is better)
                // Score factors:
                // - Closer pickup = higher score (max 40 points)
                // - Higher profit margin = higher score (max 40 points)
                // - Newer rides = slight bonus (max 20 points)

                const distanceScore = Math.max(0, 40 * (1 - distanceToPickup / maxPickupRadius));
                const profitMargin = ridePrice > 0 ? (ridePrice - driverMinPrice) / ridePrice : 0;
                const profitScore = Math.min(40, profitMargin * 100);

                const rideAgeMinutes = (Date.now() - new Date(ride.createdAt).getTime()) / 60000;
                const freshnessScore = Math.max(0, 20 * (1 - Math.min(rideAgeMinutes, 60) / 60));

                const matchScore = distanceScore + profitScore + freshnessScore;

                matchingRides.push({
                    ...ride,
                    distanceToPickup: Math.round(distanceToPickup * 100) / 100,
                    driverMinPrice: Math.round(driverMinPrice * 100) / 100,
                    ridePrice,
                    matchScore: Math.round(matchScore * 10) / 10,
                });
            }

            // 4. Sort based on preference
            switch (sortBy) {
                case 'distance':
                    matchingRides.sort((a, b) => a.distanceToPickup - b.distanceToPickup);
                    break;
                case 'price':
                    matchingRides.sort((a, b) => b.ridePrice - a.ridePrice);
                    break;
                case 'score':
                default:
                    matchingRides.sort((a, b) => b.matchScore - a.matchScore);
            }

            // 5. Apply limit
            const limitedRides = matchingRides.slice(0, limit);

            return {
                success: true,
                driverPreferences: {
                    pricePerKm,
                    minPricePerRide,
                    maxPickupRadiusKm: maxPickupRadius,
                    vehicleType: driverVehicleType,
                    maxPassengers: driverMaxPassengers,
                    currentLocation: { latitude: driverLat, longitude: driverLng }
                },
                matchingRides: limitedRides,
                totalMatches: matchingRides.length,
                totalPending: pendingRides.length,
            };

        } catch (error) {
            console.error('Error finding matching rides:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    });
