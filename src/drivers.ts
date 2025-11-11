import { Elysia } from 'elysia';
import { v4 as uuidv4 } from 'uuid';
import type { DriverApplicationRequest, Driver, FullDriver, DriverAvailabilityUpdate, DriverUpdateRequest, DriverLocation, toSimpleDriver } from "./types.ts";
import type { Sql } from 'postgres';

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
    .post('/check', async ({ body, db }: { body: { email: string }; db: Sql }) => {
        try {
            const { email } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            const drivers = await db`
                SELECT * FROM drivers WHERE email = ${email}
            `;

            if (drivers.length > 0) {
                const row = drivers[0];
                const existingDriver: FullDriver = {
                    id: row.id,
                    fullName: row.full_name,
                    email: row.email,
                    phoneNumber: row.phone_number,
                    address: row.address,
                    licenseNumber: row.license_number,
                    vehicleModel: row.vehicle_model,
                    vehicleYear: row.vehicle_year,
                    vehiclePlate: row.vehicle_plate,
                    motivation: row.motivation,
                    status: row.status,
                    availability: row.availability,
                    currentRideId: row.current_ride_id,
                    lastLocationUpdate: row.last_location_update,
                    latitude: row.latitude,
                    longitude: row.longitude,
                    applicationDate: row.application_date,
                    approvalDate: row.approval_date,
                    rejectionReason: row.rejection_reason,
                    username: row.username,
                    walletAddress: row.wallet_address,
                    isDriver: row.is_driver,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                };
                
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

    // Submit new driver application
    .post('/apply', async ({ body, db }: { body: DriverApplicationRequest; db: Sql }) => {
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
            const existing = await db`
                SELECT id FROM drivers WHERE email = ${applicationData.email}
            `;
            
            if (existing.length > 0) {
                return {
                    error: 'Driver application already exists for this email',
                    status: 400,
                };
            }

            // Check if license number is already in use
            const existingLicense = await db`
                SELECT id FROM drivers WHERE license_number = ${applicationData.licenseNumber}
            `;
            
            if (existingLicense.length > 0) {
                return {
                    error: 'Driver with this license number already exists',
                    status: 400,
                };
            }

            // Check if vehicle plate is already in use
            const existingPlate = await db`
                SELECT id FROM drivers WHERE vehicle_plate = ${applicationData.vehiclePlate}
            `;
            
            if (existingPlate.length > 0) {
                return {
                    error: 'Vehicle with this plate number is already registered',
                    status: 400,
                };
            }

            // Create new driver application
            const driverId = uuidv4();
            const now = new Date().toISOString();

            await db`
                INSERT INTO drivers (
                    id, full_name, email, phone_number, address,
                    license_number, vehicle_model, vehicle_year, vehicle_plate,
                    motivation, status, availability, username, wallet_address, is_driver,
                    application_date, created_at, updated_at
                ) VALUES (
                    ${driverId}, ${applicationData.fullName}, ${applicationData.email},
                    ${applicationData.phoneNumber}, ${applicationData.address},
                    ${applicationData.licenseNumber}, ${applicationData.vehicleModel},
                    ${applicationData.vehicleYear}, ${applicationData.vehiclePlate},
                    ${applicationData.motivation || null}, 'pending', 'offline',
                    ${applicationData.fullName}, '', false,
                    ${now}, ${now}, ${now}
                )
            `;

            const responseDriver: Driver = {
                id: driverId,
                email: applicationData.email,
                username: applicationData.fullName,
                walletAddress: '',
                isDriver: true,
                createdAt: now,
                updatedAt: now,
            };

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
    .put('/update', async ({ body, db }: { body: DriverUpdateRequest; db: Sql }) => {
        try {
            const { id, ...updateData } = body;

            if (!id) {
                return {
                    error: 'Driver ID is required',
                    status: 400,
                };
            }

            // Get existing driver
            const existing = await db`
                SELECT * FROM drivers WHERE id = ${id}
            `;
            
            if (existing.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const existingDriver = existing[0];

            // Check for conflicts
            if (updateData.email && updateData.email !== existingDriver.email) {
                const emailConflict = await db`
                    SELECT id FROM drivers WHERE email = ${updateData.email}
                `;
                if (emailConflict.length > 0) {
                    return {
                        error: 'Email already in use by another driver',
                        status: 400,
                    };
                }
            }

            if (updateData.licenseNumber && updateData.licenseNumber !== existingDriver.license_number) {
                const licenseConflict = await db`
                    SELECT id FROM drivers WHERE license_number = ${updateData.licenseNumber}
                `;
                if (licenseConflict.length > 0) {
                    return {
                        error: 'License number already in use',
                        status: 400,
                    };
                }
            }

            if (updateData.vehiclePlate && updateData.vehiclePlate !== existingDriver.vehicle_plate) {
                const plateConflict = await db`
                    SELECT id FROM drivers WHERE vehicle_plate = ${updateData.vehiclePlate}
                `;
                if (plateConflict.length > 0) {
                    return {
                        error: 'Vehicle plate already in use',
                        status: 400,
                    };
                }
            }

            const now = new Date().toISOString();
            const approvalDate = updateData.status === 'approved' && existingDriver.status !== 'approved' ? now : existingDriver.approval_date;

            // Build update query
            const result = await db`
                UPDATE drivers SET
                    ${updateData.fullName ? db`full_name = ${updateData.fullName},` : db``}
                    ${updateData.email ? db`email = ${updateData.email},` : db``}
                    ${updateData.phoneNumber ? db`phone_number = ${updateData.phoneNumber},` : db``}
                    ${updateData.address ? db`address = ${updateData.address},` : db``}
                    ${updateData.licenseNumber ? db`license_number = ${updateData.licenseNumber},` : db``}
                    ${updateData.vehicleModel ? db`vehicle_model = ${updateData.vehicleModel},` : db``}
                    ${updateData.vehicleYear ? db`vehicle_year = ${updateData.vehicleYear},` : db``}
                    ${updateData.vehiclePlate ? db`vehicle_plate = ${updateData.vehiclePlate},` : db``}
                    ${updateData.motivation !== undefined ? db`motivation = ${updateData.motivation},` : db``}
                    ${updateData.status ? db`status = ${updateData.status},` : db``}
                    ${approvalDate && approvalDate !== existingDriver.approval_date ? db`approval_date = ${approvalDate},` : db``}
                    updated_at = ${now}
                WHERE id = ${id}
                RETURNING *
            `;

            // Update user's isDriver status if driver is approved
            if (updateData.status === 'approved' && existingDriver.status !== 'approved') {
                try {
                    await db`
                        UPDATE users 
                        SET is_driver = true, driver_id = ${id}, updated_at = ${now}
                        WHERE email = ${existingDriver.email}
                    `;
                    console.log(`✅ Updated user ${existingDriver.email} isDriver status to true`);
                } catch (error) {
                    console.error('❌ Failed to update user isDriver status:', error);
                }
            }

            const row = result[0];
            const updatedDriver: FullDriver = {
                id: row.id,
                fullName: row.full_name,
                email: row.email,
                phoneNumber: row.phone_number,
                address: row.address,
                licenseNumber: row.license_number,
                vehicleModel: row.vehicle_model,
                vehicleYear: row.vehicle_year,
                vehiclePlate: row.vehicle_plate,
                motivation: row.motivation,
                status: row.status,
                availability: row.availability,
                currentRideId: row.current_ride_id,
                lastLocationUpdate: row.last_location_update,
                latitude: row.latitude,
                longitude: row.longitude,
                applicationDate: row.application_date,
                approvalDate: row.approval_date,
                rejectionReason: row.rejection_reason,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };

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

    // Get driver by ID
    .get('/:id', async ({ params, db }: { params: { id: string }; db: Sql }) => {
        try {
            const { id } = params;

            const drivers = await db`
                SELECT * FROM drivers WHERE id = ${id}
            `;

            if (drivers.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const row = drivers[0];
            const driver: Driver = {
                id: row.id,
                email: row.email,
                username: row.full_name,
                walletAddress: row.wallet_address || '',
                isDriver: row.status === 'approved',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };

            return { driver };

        } catch (error) {
            console.error('Error fetching driver:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Update driver availability status
    .put('/availability', async ({ body, db }: { body: DriverAvailabilityUpdate; db: Sql }) => {
        try {
            const { driverId, availability, currentRideId, latitude, longitude } = body;

            if (!driverId || !availability) {
                return {
                    error: 'Driver ID and availability status are required',
                    status: 400,
                };
            }

            // Get existing driver
            const drivers = await db`
                SELECT * FROM drivers WHERE id = ${driverId}
            `;
            
            if (drivers.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver = drivers[0];

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

            const now = new Date().toISOString();

            const result = await db`
                UPDATE drivers SET
                    availability = ${availability},
                    current_ride_id = ${availability === 'online_busy' ? currentRideId : null},
                    ${latitude !== undefined ? db`latitude = ${latitude},` : db``}
                    ${longitude !== undefined ? db`longitude = ${longitude},` : db``}
                    last_location_update = ${now},
                    updated_at = ${now}
                WHERE id = ${driverId}
                RETURNING *
            `;

            const row = result[0];
            const updatedDriver: FullDriver = {
                id: row.id,
                fullName: row.full_name,
                email: row.email,
                phoneNumber: row.phone_number,
                address: row.address,
                licenseNumber: row.license_number,
                vehicleModel: row.vehicle_model,
                vehicleYear: row.vehicle_year,
                vehiclePlate: row.vehicle_plate,
                motivation: row.motivation,
                status: row.status,
                availability: row.availability,
                currentRideId: row.current_ride_id,
                lastLocationUpdate: row.last_location_update,
                latitude: row.latitude,
                longitude: row.longitude,
                applicationDate: row.application_date,
                approvalDate: row.approval_date,
                rejectionReason: row.rejection_reason,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };

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
    .get('/availability/:status', async ({ params, query, db }: {
        params: { status: string };
        query: { latitude?: string; longitude?: string; radius?: string; limit?: string };
        db: Sql;
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

            let drivers;
            
            if (latitude && longitude && status === 'online_free') {
                const userLat = parseFloat(latitude);
                const userLng = parseFloat(longitude);
                const radiusKm = parseFloat(radius);
                const limitNum = parseInt(limit);

                // Use Haversine formula in SQL
                drivers = await db`
                    SELECT *,
                        (6371 * acos(
                            cos(radians(${userLat})) * cos(radians(latitude)) *
                            cos(radians(longitude) - radians(${userLng})) +
                            sin(radians(${userLat})) * sin(radians(latitude))
                        )) AS distance
                    FROM drivers
                    WHERE availability = ${status}
                        AND latitude IS NOT NULL
                        AND longitude IS NOT NULL
                    HAVING distance <= ${radiusKm}
                    ORDER BY distance
                    LIMIT ${limitNum}
                `;
            } else {
                const limitNum = parseInt(limit);
                drivers = await db`
                    SELECT * FROM drivers
                    WHERE availability = ${status}
                    ORDER BY updated_at DESC
                    LIMIT ${limitNum}
                `;
            }

            const fullDrivers: FullDriver[] = drivers.map(row => ({
                id: row.id,
                fullName: row.full_name,
                email: row.email,
                phoneNumber: row.phone_number,
                address: row.address,
                licenseNumber: row.license_number,
                vehicleModel: row.vehicle_model,
                vehicleYear: row.vehicle_year,
                vehiclePlate: row.vehicle_plate,
                motivation: row.motivation,
                status: row.status,
                availability: row.availability,
                currentRideId: row.current_ride_id,
                lastLocationUpdate: row.last_location_update,
                latitude: row.latitude,
                longitude: row.longitude,
                applicationDate: row.application_date,
                approvalDate: row.approval_date,
                rejectionReason: row.rejection_reason,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            }));

            return {
                drivers: fullDrivers,
                count: fullDrivers.length
            };

        } catch (error) {
            console.error('Error fetching drivers by availability:', error);
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

            // First try to get location from dedicated location storage
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

                if (drivers.length > 0 && drivers[0].latitude && drivers[0].longitude) {
                    return {
                        location: {
                            driverId,
                            latitude: drivers[0].latitude,
                            longitude: drivers[0].longitude,
                            timestamp: drivers[0].last_location_update || new Date().toISOString(),
                        }
                    };
                }

                return { location: null };
            }

            const loc = locations[0];
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

    // Update driver location
    .put('/:id/location', async ({ params, body, db }: {
        params: { id: string };
        body: {
            latitude: number;
            longitude: number;
            heading?: number;
            speed?: number;
            accuracy?: number;
        };
        db: Sql;
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
            const drivers = await db`
                SELECT id FROM drivers WHERE id = ${driverId}
            `;
            
            if (drivers.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const now = new Date().toISOString();

            // Upsert location in driver_locations table
            await db`
                INSERT INTO driver_locations (driver_id, latitude, longitude, heading, speed, accuracy, timestamp)
                VALUES (${driverId}, ${latitude}, ${longitude}, ${heading || null}, ${speed || null}, ${accuracy || null}, ${now})
                ON CONFLICT (driver_id) 
                DO UPDATE SET
                    latitude = ${latitude},
                    longitude = ${longitude},
                    heading = ${heading || null},
                    speed = ${speed || null},
                    accuracy = ${accuracy || null},
                    timestamp = ${now}
            `;

            // Also update the driver record with latest location
            await db`
                UPDATE drivers 
                SET 
                    latitude = ${latitude},
                    longitude = ${longitude},
                    last_location_update = ${now},
                    updated_at = ${now}
                WHERE id = ${driverId}
            `;

            const locationUpdate = {
                driverId,
                latitude,
                longitude,
                heading,
                speed,
                accuracy,
                timestamp: now,
            };

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
    .put('/:id/wallet', async ({ params, body, db }: {
        params: { id: string };
        body: { walletAddress: string };
        db: Sql;
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

            const now = new Date().toISOString();

            const result = await db`
                UPDATE drivers 
                SET wallet_address = ${walletAddress}, updated_at = ${now}
                WHERE id = ${id}
                RETURNING *
            `;

            if (result.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const row = result[0];
            const driver: Driver = {
                id: row.id,
                email: row.email,
                username: row.full_name,
                walletAddress: row.wallet_address,
                isDriver: row.status === 'approved',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };

            return {
                success: true,
                driver
            };

        } catch (error) {
            console.error('Error updating driver wallet:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Start a ride (set driver as busy)
    .post('/start-ride', async ({ body, db }: { 
        body: { driverId: string; rideId: string; latitude?: number; longitude?: number }; 
        db: Sql 
    }) => {
        try {
            const { driverId, rideId, latitude, longitude } = body;

            if (!driverId || !rideId) {
                return {
                    error: 'Driver ID and Ride ID are required',
                    status: 400,
                };
            }

            const drivers = await db`
                SELECT * FROM drivers WHERE id = ${driverId}
            `;
            
            if (drivers.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver = drivers[0];

            if (driver.availability !== 'online_free') {
                return {
                    error: 'Driver must be online and free to start a ride',
                    status: 400,
                };
            }

            const now = new Date().toISOString();

            const result = await db`
                UPDATE drivers SET
                    availability = 'online_busy',
                    current_ride_id = ${rideId},
                    ${latitude !== undefined ? db`latitude = ${latitude},` : db``}
                    ${longitude !== undefined ? db`longitude = ${longitude},` : db``}
                    last_location_update = ${now},
                    updated_at = ${now}
                WHERE id = ${driverId}
                RETURNING *
            `;

            const row = result[0];
            const updatedDriver: FullDriver = {
                id: row.id,
                fullName: row.full_name,
                email: row.email,
                phoneNumber: row.phone_number,
                address: row.address,
                licenseNumber: row.license_number,
                vehicleModel: row.vehicle_model,
                vehicleYear: row.vehicle_year,
                vehiclePlate: row.vehicle_plate,
                motivation: row.motivation,
                status: row.status,
                availability: row.availability,
                currentRideId: row.current_ride_id,
                lastLocationUpdate: row.last_location_update,
                latitude: row.latitude,
                longitude: row.longitude,
                applicationDate: row.application_date,
                approvalDate: row.approval_date,
                rejectionReason: row.rejection_reason,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };

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
    .post('/complete-ride', async ({ body, db }: { 
        body: { driverId: string; rideId: string; latitude?: number; longitude?: number }; 
        db: Sql 
    }) => {
        try {
            const { driverId, rideId, latitude, longitude } = body;

            if (!driverId || !rideId) {
                return {
                    error: 'Driver ID and Ride ID are required',
                    status: 400,
                };
            }

            const drivers = await db`
                SELECT * FROM drivers WHERE id = ${driverId}
            `;
            
            if (drivers.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver = drivers[0];

            if (driver.availability !== 'online_busy' || driver.current_ride_id !== rideId) {
                return {
                    error: 'Driver is not currently on this ride',
                    status: 400,
                };
            }

            const now = new Date().toISOString();

            const result = await db`
                UPDATE drivers SET
                    availability = 'online_free',
                    current_ride_id = NULL,
                    ${latitude !== undefined ? db`latitude = ${latitude},` : db``}
                    ${longitude !== undefined ? db`longitude = ${longitude},` : db``}
                    last_location_update = ${now},
                    updated_at = ${now}
                WHERE id = ${driverId}
                RETURNING *
            `;

            const row = result[0];
            const updatedDriver: FullDriver = {
                id: row.id,
                fullName: row.full_name,
                email: row.email,
                phoneNumber: row.phone_number,
                address: row.address,
                licenseNumber: row.license_number,
                vehicleModel: row.vehicle_model,
                vehicleYear: row.vehicle_year,
                vehiclePlate: row.vehicle_plate,
                motivation: row.motivation,
                status: row.status,
                availability: row.availability,
                currentRideId: row.current_ride_id,
                lastLocationUpdate: row.last_location_update,
                latitude: row.latitude,
                longitude: row.longitude,
                applicationDate: row.application_date,
                approvalDate: row.approval_date,
                rejectionReason: row.rejection_reason,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };

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
    .get('/stats/availability', async ({ db }: { db: Sql }) => {
        try {
            const stats = await db`
                SELECT 
                    availability,
                    COUNT(*) as count
                FROM drivers
                GROUP BY availability
            `;

            const availability = {
                offline: 0,
                online_free: 0,
                online_busy: 0,
                total: 0
            };

            stats.forEach(row => {
                availability[row.availability] = parseInt(row.count);
                availability.total += parseInt(row.count);
            });

            return { availability };

        } catch (error) {
            console.error('Error fetching availability stats:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get all drivers with optional status filter
    .get('/', async ({ query, db }: { query: { status?: string; page?: string; limit?: string }; db: Sql }) => {
        try {
            const status = query.status;
            const page = parseInt(query.page || '1');
            const limit = parseInt(query.limit || '50');
            const offset = (page - 1) * limit;

            let drivers;
            let totalResult;

            if (status) {
                drivers = await db`
                    SELECT * FROM drivers
                    WHERE status = ${status}
                    ORDER BY application_date DESC
                    LIMIT ${limit} OFFSET ${offset}
                `;
                totalResult = await db`
                    SELECT COUNT(*) as count FROM drivers WHERE status = ${status}
                `;
            } else {
                drivers = await db`
                    SELECT * FROM drivers
                    ORDER BY application_date DESC
                    LIMIT ${limit} OFFSET ${offset}
                `;
                totalResult = await db`
                    SELECT COUNT(*) as count FROM drivers
                `;
            }

            const fullDrivers: FullDriver[] = drivers.map(row => ({
                id: row.id,
                fullName: row.full_name,
                email: row.email,
                phoneNumber: row.phone_number,
                address: row.address,
                licenseNumber: row.license_number,
                vehicleModel: row.vehicle_model,
                vehicleYear: row.vehicle_year,
                vehiclePlate: row.vehicle_plate,
                motivation: row.motivation,
                status: row.status,
                availability: row.availability,
                currentRideId: row.current_ride_id,
                lastLocationUpdate: row.last_location_update,
                latitude: row.latitude,
                longitude: row.longitude,
                applicationDate: row.application_date,
                approvalDate: row.approval_date,
                rejectionReason: row.rejection_reason,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            }));

            const total = parseInt(totalResult[0].count);

            return {
                drivers: fullDrivers,
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
    .post('/approve/:id', async ({ params, db }: { params: { id: string }; db: Sql }) => {
        try {
            const { id } = params;

            const drivers = await db`
                SELECT * FROM drivers WHERE id = ${id}
            `;
            
            if (drivers.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const driver = drivers[0];

            if (driver.status === 'approved') {
                return {
                    error: 'Driver is already approved',
                    status: 400,
                };
            }

            const now = new Date().toISOString();

            const result = await db`
                UPDATE drivers 
                SET status = 'approved', approval_date = ${now}, updated_at = ${now}
                WHERE id = ${id}
                RETURNING *
            `;

            const row = result[0];
            const updatedDriver: FullDriver = {
                id: row.id,
                fullName: row.full_name,
                email: row.email,
                phoneNumber: row.phone_number,
                address: row.address,
                licenseNumber: row.license_number,
                vehicleModel: row.vehicle_model,
                vehicleYear: row.vehicle_year,
                vehiclePlate: row.vehicle_plate,
                motivation: row.motivation,
                status: row.status,
                availability: row.availability,
                currentRideId: row.current_ride_id,
                lastLocationUpdate: row.last_location_update,
                latitude: row.latitude,
                longitude: row.longitude,
                applicationDate: row.application_date,
                approvalDate: row.approval_date,
                rejectionReason: row.rejection_reason,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };

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
    .post('/reject/:id', async ({ params, body, db }: { 
        params: { id: string }; 
        body: { reason?: string }; 
        db: Sql 
    }) => {
        try {
            const { id } = params;
            const { reason } = body || {};

            const drivers = await db`
                SELECT * FROM drivers WHERE id = ${id}
            `;
            
            if (drivers.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

            const now = new Date().toISOString();

            const result = await db`
                UPDATE drivers 
                SET 
                    status = 'rejected',
                    ${reason ? db`rejection_reason = ${reason},` : db``}
                    updated_at = ${now}
                WHERE id = ${id}
                RETURNING *
            `;

            const row = result[0];
            const updatedDriver: FullDriver = {
                id: row.id,
                fullName: row.full_name,
                email: row.email,
                phoneNumber: row.phone_number,
                address: row.address,
                licenseNumber: row.license_number,
                vehicleModel: row.vehicle_model,
                vehicleYear: row.vehicle_year,
                vehiclePlate: row.vehicle_plate,
                motivation: row.motivation,
                status: row.status,
                availability: row.availability,
                currentRideId: row.current_ride_id,
                lastLocationUpdate: row.last_location_update,
                latitude: row.latitude,
                longitude: row.longitude,
                applicationDate: row.application_date,
                approvalDate: row.approval_date,
                rejectionReason: row.rejection_reason,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            };

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
    .delete('/:id', async ({ params, db }: { params: { id: string }; db: Sql }) => {
        try {
            const { id } = params;

            // Delete driver location first (foreign key)
            await db`DELETE FROM driver_locations WHERE driver_id = ${id}`;

            // Delete driver
            const result = await db`
                DELETE FROM drivers WHERE id = ${id} RETURNING id
            `;

            if (result.length === 0) {
                return {
                    error: 'Driver not found',
                    status: 404,
                };
            }

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
