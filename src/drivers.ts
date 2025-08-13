import { Elysia } from 'elysia';
import { v4 as uuidv4 } from 'uuid';
import type { DriverApplicationRequest, Driver, FullDriver, DriverAvailabilityUpdate, DriverUpdateRequest, DriverLocation, toSimpleDriver } from "./types.ts";


function validateDriverApplication(data: DriverApplicationRequest): string | null {
    if (!data.fullName?.trim()) return 'Full name is required';
    if (!data.email?.trim()) return 'Email is required';
    if (!data.phoneNumber?.trim()) return 'Phone number is required';
    if (!data.licenseNumber?.trim()) return 'Driver\'s license number is required';
    if (!data.vehicleModel?.trim()) return 'Vehicle model is required';
    if (!data.vehiclePlate?.trim()) return 'Vehicle plate number is required';

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) return 'Invalid email format';

    return null;
}

export const driverRoutes = new Elysia({ prefix: '/api/drivers' })
    // Check if driver application exists
    .post('/check', async ({ body, redis }: { body: { email: string }; redis: any }) => {
        try {
            const { email } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Check if driver exists
            const driverData = await redis.get(`driver:${email}`);

            if (driverData) {
                const existingDriver: FullDriver = JSON.parse(driverData);
                return {
                    exists: true,
                    driver: existingDriver
                };
            }

            return {
                exists: false
            };

        } catch (error) {
            console.error('Error checking driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Update driver availability status
    .put('/availability', async ({ body, redis }: { body: DriverAvailabilityUpdate; redis: any }) => {
        try {
            const { driverId, availability, currentRideId, latitude, longitude } = body;

            if (!driverId || !availability) {
                return {
                    error: 'Driver ID and availability status are required',
                    status: 400,
                };
            }

            // Get existing driver
            const driverData = await redis.get(`driver:id:${driverId}`);
            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: FullDriver = JSON.parse(driverData);

            // Only approved drivers can change availability
            if (driver.status !== 'approved') {
                return {
                    error: 'Only approved drivers can change availability status',
                    status: 400,
                };
            }

            // Validate availability transitions
            if (availability === 'online_busy' && !currentRideId) {
                return {
                    error: 'Ride ID is required when setting status to busy',
                    status: 400,
                };
            }

            if (availability !== 'online_busy' && currentRideId) {
                return {
                    error: 'Ride ID should only be provided when status is busy',
                    status: 400,
                };
            }

            const updatedDriver: FullDriver = {
                ...driver,
                availability,
                currentRideId: availability === 'online_busy' ? currentRideId : undefined,
                latitude,
                longitude,
                lastLocationUpdate: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            // Update all Redis keys
            const driverJson = JSON.stringify(updatedDriver);
            await redis.set(`driver:${driver.email}`, driverJson);
            await redis.set(`driver:id:${driverId}`, driverJson);
            await redis.set(`driver:license:${driver.licenseNumber}`, driverJson);
            await redis.set(`driver:plate:${driver.vehiclePlate}`, driverJson);

            // Update availability index for quick lookups
            await redis.sAdd(`drivers:${availability}`, driverId);

            // Remove from other availability sets
            const availabilityStates = ['offline', 'online_free', 'online_busy'];
            for (const state of availabilityStates) {
                if (state !== availability) {
                    await redis.sRem(`drivers:${state}`, driverId);
                }
            }

            return {
                success: true,
                driver: updatedDriver
            };

        } catch (error) {
            console.error('Error updating driver availability:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get drivers by availability status
    .get('/availability/:status', async ({ params, query, redis }: {
        params: { status: string };
        query: { latitude?: string; longitude?: string; radius?: string; limit?: string };
        redis: any
    }) => {
        try {
            const { status } = params;
            const { latitude, longitude, radius = '10', limit = '50' } = query;

            if (!['offline', 'online_free', 'online_busy'].includes(status)) {
                return {
                    error: 'Invalid availability status',
                    status: 400,
                };
            }

            // Get driver IDs from availability set
            const driverIds = await redis.sMembers(`drivers:${status}`);

            if (driverIds.length === 0) {
                return {
                    drivers: [],
                    count: 0
                };
            }

            // Get driver details
            const drivers = await Promise.all(
                driverIds.map(async (id: string) => {
                    const driverData = await redis.get(`driver:id:${id}`);
                    return driverData ? JSON.parse(driverData) as FullDriver : null;
                })
            );

            let filteredDrivers = drivers.filter(Boolean);

            // Filter by location if provided
            if (latitude && longitude && status === 'online_free') {
                const userLat = parseFloat(latitude);
                const userLng = parseFloat(longitude);
                const radiusKm = parseFloat(radius);

                filteredDrivers = filteredDrivers.filter((driver: FullDriver) => {
                    if (!driver.latitude || !driver.longitude) return false;

                    // Calculate distance using Haversine formula
                    const R = 6371; // Earth's radius in km
                    const dLat = (driver.latitude - userLat) * Math.PI / 180;
                    const dLng = (driver.longitude - userLng) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(userLat * Math.PI / 180) * Math.cos(driver.latitude * Math.PI / 180) *
                        Math.sin(dLng / 2) * Math.sin(dLng / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    const distance = R * c;

                    return distance <= radiusKm;
                });

                // Sort by distance
                filteredDrivers.sort((a: FullDriver, b: FullDriver) => {
                    if (!a.latitude || !a.longitude || !b.latitude || !b.longitude) return 0;

                    const distanceA = Math.sqrt(
                        Math.pow(a.latitude - userLat, 2) + Math.pow(a.longitude - userLng, 2)
                    );
                    const distanceB = Math.sqrt(
                        Math.pow(b.latitude - userLat, 2) + Math.pow(b.longitude - userLng, 2)
                    );

                    return distanceA - distanceB;
                });
            }

            // Apply limit
            const limitedDrivers = filteredDrivers.slice(0, parseInt(limit));

            return {
                drivers: limitedDrivers,
                count: limitedDrivers.length,
                total: filteredDrivers.length
            };

        } catch (error) {
            console.error('Error fetching drivers by availability:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Start a ride (set driver as busy)
    .post('/start-ride', async ({ body, redis }: { body: { driverId: string; rideId: string; latitude?: number; longitude?: number }; redis: any }) => {
        try {
            const { driverId, rideId, latitude, longitude } = body;

            if (!driverId || !rideId) {
                return {
                    error: 'Driver ID and Ride ID are required',
                    status: 400,
                };
            }

            const driverData = await redis.get(`driver:id:${driverId}`);
            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: FullDriver = JSON.parse(driverData);

            if (driver.availability !== 'online_free') {
                return {
                    error: 'Driver must be online and free to start a ride',
                    status: 400,
                };
            }

            const updatedDriver: FullDriver = {
                ...driver,
                availability: 'online_busy',
                currentRideId: rideId,
                latitude,
                longitude,
                lastLocationUpdate: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            // Update all Redis keys
            const driverJson = JSON.stringify(updatedDriver);
            await redis.set(`driver:${driver.email}`, driverJson);
            await redis.set(`driver:id:${driverId}`, driverJson);
            await redis.set(`driver:license:${driver.licenseNumber}`, driverJson);
            await redis.set(`driver:plate:${driver.vehiclePlate}`, driverJson);

            // Update availability sets
            await redis.sAdd('drivers:online_busy', driverId);
            await redis.sRem('drivers:online_free', driverId);

            return {
                success: true,
                driver: updatedDriver,
                message: 'Ride started successfully'
            };

        } catch (error) {
            console.error('Error starting ride:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Complete a ride (set driver as free)
    .post('/complete-ride', async ({ body, redis }: { body: { driverId: string; rideId: string; latitude?: number; longitude?: number }; redis: any }) => {
        try {
            const { driverId, rideId, latitude, longitude } = body;

            if (!driverId || !rideId) {
                return {
                    error: 'Driver ID and Ride ID are required',
                    status: 400,
                };
            }

            const driverData = await redis.get(`driver:id:${driverId}`);
            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: FullDriver = JSON.parse(driverData);

            if (driver.availability !== 'online_busy' || driver.currentRideId !== rideId) {
                return {
                    error: 'Driver is not currently on this ride',
                    status: 400,
                };
            }

            const updatedDriver: FullDriver = {
                ...driver,
                availability: 'online_free',
                currentRideId: undefined,
                latitude,
                longitude,
                lastLocationUpdate: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            // Update all Redis keys
            const driverJson = JSON.stringify(updatedDriver);
            await redis.set(`driver:${driver.email}`, driverJson);
            await redis.set(`driver:id:${driverId}`, driverJson);
            await redis.set(`driver:license:${driver.licenseNumber}`, driverJson);
            await redis.set(`driver:plate:${driver.vehiclePlate}`, driverJson);

            // Update availability sets
            await redis.sAdd('drivers:online_free', driverId);
            await redis.sRem('drivers:online_busy', driverId);

            return {
                success: true,
                driver: updatedDriver,
                message: 'Ride completed successfully'
            };

        } catch (error) {
            console.error('Error completing ride:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get driver statistics
    .get('/stats/availability', async ({ redis }: { redis: any }) => {
        try {
            const [offline, onlineFree, onlineBusy] = await Promise.all([
                redis.sCard('drivers:offline'),
                redis.sCard('drivers:online_free'),
                redis.sCard('drivers:online_busy')
            ]);

            return {
                availability: {
                    offline,
                    online_free: onlineFree,
                    online_busy: onlineBusy,
                    total: offline + onlineFree + onlineBusy
                }
            };

        } catch (error) {
            console.error('Error fetching availability stats:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Submit new driver application
    .post('/apply', async ({ body, redis }: { body: DriverApplicationRequest; redis: any }) => {
        try {
            const applicationData = body;

            // Validate application data
            const validationError = validateDriverApplication(applicationData);
            if (validationError) {
                return {
                    error: validationError,
                    status: 400,
                };
            }

            // Check if driver already exists
            const existingDriverData = await redis.get(`driver:${applicationData.email}`);
            if (existingDriverData) {
                return {
                    error: 'Driver application already exists for this email',
                    status: 400,
                };
            }

            // Check if license number is already in use
            const existingLicenseData = await redis.get(`driver:license:${applicationData.licenseNumber}`);
            if (existingLicenseData) {
                return {
                    error: 'Driver with this license number already exists',
                    status: 400,
                };
            }

            // Check if vehicle plate is already in use
            const existingPlateData = await redis.get(`driver:plate:${applicationData.vehiclePlate}`);
            if (existingPlateData) {
                return {
                    error: 'Vehicle with this plate number is already registered',
                    status: 400,
                };
            }

            // Create new driver application
            const driverId = uuidv4();
            const now = new Date().toISOString();

            // ✅ Updated to include missing fields for frontend compatibility
            const newDriver: FullDriver = {
                id: driverId,
                fullName: applicationData.fullName,
                email: applicationData.email,
                phoneNumber: applicationData.phoneNumber,
                address: applicationData.address,
                licenseNumber: applicationData.licenseNumber,
                vehicleModel: applicationData.vehicleModel,
                vehicleYear: applicationData.vehicleYear,
                vehiclePlate: applicationData.vehiclePlate,
                motivation: applicationData.motivation,
                status: 'pending',
                availability: 'offline', // New drivers start offline
                applicationDate: now,
                createdAt: now,
                updatedAt: now,
                // ✅ Add missing fields for frontend compatibility
                username: applicationData.fullName,
                walletAddress: '', // Will be updated later when driver connects wallet
                isDriver: true, // Will be true when approved
            };

            // Store driver in Redis with multiple keys for different lookups
            const driverJson = JSON.stringify(newDriver);
            await redis.set(`driver:${applicationData.email}`, driverJson);
            await redis.set(`driver:id:${driverId}`, driverJson);
            await redis.set(`driver:license:${applicationData.licenseNumber}`, driverJson);
            await redis.set(`driver:plate:${applicationData.vehiclePlate}`, driverJson);

            // ✅ Return simplified driver interface for frontend
            const responseDriver: Driver = toSimpleDriver(newDriver);

            return {
                success: true,
                driver: responseDriver,
                message: 'Driver application submitted successfully'
            };

        } catch (error) {
            console.error('Error creating driver application:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Update driver information or status
    .put('/update', async ({ body, redis }: { body: DriverUpdateRequest; redis: any }) => {
        try {
            const { id, ...updateData } = body;

            if (!id) {
                return {
                    error: 'Driver ID is required',
                    status: 400,
                };
            }

            // Get existing driver
            const existingDriverData = await redis.get(`driver:id:${id}`);
            if (!existingDriverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const existingDriver: FullDriver = JSON.parse(existingDriverData);

            // If email is being updated, check for conflicts
            if (updateData.email && updateData.email !== existingDriver.email) {
                const emailConflict = await redis.get(`driver:${updateData.email}`);
                if (emailConflict) {
                    return {
                        error: 'Email already in use by another driver',
                        status: 400,
                    };
                }
            }

            // If license number is being updated, check for conflicts
            if (updateData.licenseNumber && updateData.licenseNumber !== existingDriver.licenseNumber) {
                const licenseConflict = await redis.get(`driver:license:${updateData.licenseNumber}`);
                if (licenseConflict) {
                    return {
                        error: 'License number already in use',
                        status: 400,
                    };
                }
            }

            // If vehicle plate is being updated, check for conflicts
            if (updateData.vehiclePlate && updateData.vehiclePlate !== existingDriver.vehiclePlate) {
                const plateConflict = await redis.get(`driver:plate:${updateData.vehiclePlate}`);
                if (plateConflict) {
                    return {
                        error: 'Vehicle plate already in use',
                        status: 400,
                    };
                }
            }

            // Update driver
            const updatedDriver: FullDriver = {
                ...existingDriver,
                ...updateData,
                updatedAt: new Date().toISOString(),
                ...(updateData.status === 'approved' && !existingDriver.approvalDate ? { approvalDate: new Date().toISOString() } : {}),
            };

            // Update in Redis - remove old keys if email, license, or plate changed
            const driverJson = JSON.stringify(updatedDriver);

            if (updateData.email && updateData.email !== existingDriver.email) {
                await redis.del(`driver:${existingDriver.email}`);
                await redis.set(`driver:${updateData.email}`, driverJson);
            } else {
                await redis.set(`driver:${existingDriver.email}`, driverJson);
            }

            if (updateData.licenseNumber && updateData.licenseNumber !== existingDriver.licenseNumber) {
                await redis.del(`driver:license:${existingDriver.licenseNumber}`);
                await redis.set(`driver:license:${updateData.licenseNumber}`, driverJson);
            } else {
                await redis.set(`driver:license:${existingDriver.licenseNumber}`, driverJson);
            }

            if (updateData.vehiclePlate && updateData.vehiclePlate !== existingDriver.vehiclePlate) {
                await redis.del(`driver:plate:${existingDriver.vehiclePlate}`);
                await redis.set(`driver:plate:${updateData.vehiclePlate}`, driverJson);
            } else {
                await redis.set(`driver:plate:${existingDriver.vehiclePlate}`, driverJson);
            }

            await redis.set(`driver:id:${id}`, driverJson);

            return {
                success: true,
                driver: updatedDriver
            };

        } catch (error) {
            console.error('Error updating driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // ✅ FIXED: Get driver by ID - returns simplified interface for frontend
    .get('/:id', async ({ params, redis }: { params: { id: string }; redis: any }) => {
        try {
            const { id } = params;

            const driverData = await redis.get(`driver:id:${id}`);

            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const fullDriver: FullDriver = JSON.parse(driverData);

            // ✅ Convert to simplified driver interface for frontend
            const driver: Driver = toSimpleDriver(fullDriver);

            return { driver };

        } catch (error) {
            console.error('Error fetching driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // ✅ NEW: Get driver location endpoint (required by frontend)
    .get('/:id/location', async ({ params, redis }: {
        params: { id: string };
        redis: any;
    }) => {
        try {
            const { id: driverId } = params;

            // First try to get location from dedicated location storage
            let locationData = await redis.get(`driver:location:${driverId}`);

            if (!locationData) {
                // Fallback: get location from driver record
                const driverData = await redis.get(`driver:id:${driverId}`);
                if (driverData) {
                    const driver: FullDriver = JSON.parse(driverData);
                    if (driver.latitude && driver.longitude) {
                        locationData = JSON.stringify({
                            driverId,
                            latitude: driver.latitude,
                            longitude: driver.longitude,
                            timestamp: driver.lastLocationUpdate || new Date().toISOString(),
                        });
                    }
                }
            }

            if (!locationData) {
                return {
                    location: null
                };
            }

            const location = JSON.parse(locationData);

            return {
                location
            };

        } catch (error) {
            console.error('Error getting driver location:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // ✅ NEW: Update driver location endpoint (for real-time tracking)
    .put('/:id/location', async ({ params, body, redis }: {
        params: { id: string };
        body: {
            latitude: number;
            longitude: number;
            heading?: number;
            speed?: number;
            accuracy?: number;
        };
        redis: any;
    }) => {
        try {
            const { id: driverId } = params;
            const { latitude, longitude, heading, speed, accuracy } = body;

            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                return {
                    error: 'Valid latitude and longitude are required',
                    status: 400,
                };
            }

            // Check if driver exists
            const driverData = await redis.get(`driver:id:${driverId}`);
            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const locationUpdate = {
                driverId,
                latitude,
                longitude,
                heading,
                speed,
                accuracy,
                timestamp: new Date().toISOString(),
            };

            // Store location in Redis (separate from driver record for performance)
            await redis.set(`driver:location:${driverId}`, JSON.stringify(locationUpdate));

            // Optional: Set expiration (locations older than 10 minutes are stale)
            await redis.expire(`driver:location:${driverId}`, 600); // 10 minutes

            // Also update the driver record with latest location
            const driver: FullDriver = JSON.parse(driverData);
            const updatedDriver: FullDriver = {
                ...driver,
                latitude,
                longitude,
                lastLocationUpdate: locationUpdate.timestamp,
                updatedAt: new Date().toISOString(),
            };

            // Update driver record
            const driverJson = JSON.stringify(updatedDriver);
            await redis.set(`driver:${driver.email}`, driverJson);
            await redis.set(`driver:id:${driverId}`, driverJson);
            await redis.set(`driver:license:${driver.licenseNumber}`, driverJson);
            await redis.set(`driver:plate:${driver.vehiclePlate}`, driverJson);

            return {
                success: true,
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

    // Update driver wallet address
    .put('/:id/wallet', async ({ params, body, redis }: {
        params: { id: string };
        body: { walletAddress: string };
        redis: any;
    }) => {
        try {
            const { id } = params;
            const { walletAddress } = body;

            if (!walletAddress) {
                return {
                    error: 'Wallet address is required',
                    status: 400,
                };
            }

            // Get existing driver
            const existingDriverData = await redis.get(`driver:id:${id}`);
            if (!existingDriverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const existingDriver: FullDriver = JSON.parse(existingDriverData);

            // Update driver with wallet address
            const updatedDriver: FullDriver = {
                ...existingDriver,
                walletAddress,
                updatedAt: new Date().toISOString(),
            };

            // Update all Redis keys
            const driverJson = JSON.stringify(updatedDriver);
            await redis.set(`driver:${existingDriver.email}`, driverJson);
            await redis.set(`driver:id:${id}`, driverJson);
            await redis.set(`driver:license:${existingDriver.licenseNumber}`, driverJson);
            await redis.set(`driver:plate:${existingDriver.vehiclePlate}`, driverJson);

            // ✅ Return simplified driver interface
            const responseDriver: Driver = toSimpleDriver(updatedDriver);

            return {
                success: true,
                driver: responseDriver
            };

        } catch (error) {
            console.error('Error updating driver wallet:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get driver by email
    .get('/email/:email', async ({ params, redis }: { params: { email: string }; redis: any }) => {
        try {
            const { email } = params;

            const driverData = await redis.get(`driver:${decodeURIComponent(email)}`);

            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: Driver = JSON.parse(driverData);
            return { driver };

        } catch (error) {
            console.error('Error fetching driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get driver by license number
    .get('/license/:licenseNumber', async ({ params, redis }: { params: { licenseNumber: string }; redis: any }) => {
        try {
            const { licenseNumber } = params;

            const driverData = await redis.get(`driver:license:${decodeURIComponent(licenseNumber)}`);

            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: Driver = JSON.parse(driverData);
            return { driver };

        } catch (error) {
            console.error('Error fetching driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // ✅ OPTIONAL: Get full driver details by ID (for admin/internal use)
    .get('/:id/full', async ({ params, redis }: { params: { id: string }; redis: any }) => {
        try {
            const { id } = params;

            const driverData = await redis.get(`driver:id:${id}`);

            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver = JSON.parse(driverData);
            return { driver }; // Returns full driver object

        } catch (error) {
            console.error('Error fetching full driver details:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get all drivers with optional status filter
    .get('/', async ({ query, redis }: { query: { status?: string; page?: string; limit?: string }; redis: any }) => {
        try {
            const status = query.status;
            const page = parseInt(query.page || '1');
            const limit = parseInt(query.limit || '50');
            const offset = (page - 1) * limit;

            // Get all driver keys (excluding license and plate keys)
            const keys = await redis.keys('driver:*');
            const emailKeys = keys.filter((key: string) =>
                !key.includes('driver:id:') &&
                !key.includes('driver:license:') &&
                !key.includes('driver:plate:') &&
                !key.includes('driver:location:')
            );

            let drivers = await Promise.all(
                emailKeys.map(async (key: string) => {
                    const driverData = await redis.get(key);
                    return driverData ? JSON.parse(driverData) : null;
                })
            );

            drivers = drivers.filter(Boolean);

            // Filter by status if provided
            if (status) {
                drivers = drivers.filter((driver: Driver) => driver.status === status);
            }

            // Sort by application date (newest first)
            drivers.sort((a: Driver, b: Driver) =>
                new Date(b.applicationDate).getTime() - new Date(a.applicationDate).getTime()
            );

            // Apply pagination
            const total = drivers.length;
            const paginatedDrivers = drivers.slice(offset, offset + limit);

            return {
                drivers: paginatedDrivers,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            };

        } catch (error) {
            console.error('Error fetching drivers:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Approve driver application
    .post('/approve/:id', async ({ params, redis }: { params: { id: string }; redis: any }) => {
        try {
            const { id } = params;

            const driverData = await redis.get(`driver:id:${id}`);

            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: FullDriver = JSON.parse(driverData);

            if (driver.status === 'approved') {
                return {
                    error: 'Driver is already approved',
                    status: 400,
                };
            }

            const updatedDriver: FullDriver = {
                ...driver,
                status: 'approved',
                approvalDate: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            // Update all Redis keys
            const driverJson = JSON.stringify(updatedDriver);
            await redis.set(`driver:${driver.email}`, driverJson);
            await redis.set(`driver:id:${id}`, driverJson);
            await redis.set(`driver:license:${driver.licenseNumber}`, driverJson);
            await redis.set(`driver:plate:${driver.vehiclePlate}`, driverJson);

            // Add to offline availability set when approved
            await redis.sAdd('drivers:offline', id);

            return {
                success: true,
                driver: updatedDriver,
                message: 'Driver approved successfully'
            };

        } catch (error) {
            console.error('Error approving driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Reject driver application
    .post('/reject/:id', async ({ params, body, redis }: { params: { id: string }; body: { reason?: string }; redis: any }) => {
        try {
            const { id } = params;
            const { reason } = body || {};

            const driverData = await redis.get(`driver:id:${id}`);

            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: FullDriver = JSON.parse(driverData);

            const updatedDriver: FullDriver = {
                ...driver,
                status: 'rejected',
                updatedAt: new Date().toISOString(),
                ...(reason && { rejectionReason: reason }),
            };

            // Update all Redis keys
            const driverJson = JSON.stringify(updatedDriver);
            await redis.set(`driver:${driver.email}`, driverJson);
            await redis.set(`driver:id:${id}`, driverJson);
            await redis.set(`driver:license:${driver.licenseNumber}`, driverJson);
            await redis.set(`driver:plate:${driver.vehiclePlate}`, driverJson);

            return {
                success: true,
                driver: updatedDriver,
                message: 'Driver application rejected'
            };

        } catch (error) {
            console.error('Error rejecting driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Delete driver
    .delete('/:id', async ({ params, redis }: { params: { id: string }; redis: any }) => {
        try {
            const { id } = params;

            // Get driver first to find all keys to delete
            const driverData = await redis.get(`driver:id:${id}`);

            if (!driverData) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver: FullDriver = JSON.parse(driverData);

            // Delete all keys
            await redis.del(`driver:${driver.email}`);
            await redis.del(`driver:id:${id}`);
            await redis.del(`driver:license:${driver.licenseNumber}`);
            await redis.del(`driver:plate:${driver.vehiclePlate}`);
            await redis.del(`driver:location:${id}`); // Also delete location data

            // Remove from availability sets
            await redis.sRem('drivers:offline', id);
            await redis.sRem('drivers:online_free', id);
            await redis.sRem('drivers:online_busy', id);

            return {
                success: true,
                message: 'Driver deleted successfully'
            };

        } catch (error) {
            console.error('Error deleting driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    });