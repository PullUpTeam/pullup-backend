import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { Database } from './database';
import { validateLocationData, validateRideOption } from './validation';
import type { LocationData, RideOption, RideBooking } from './types';

// Response types
interface ApiResponse<T = any> {
    success?: boolean;
    error?: string;
    booking?: T;
    bookings?: T;
    timestamp?: string;
    status?: string;
    services?: Record<string, string>;
}

interface CreateBookingRequest {
    userId: string;
    origin: LocationData;
    destination: LocationData;
    selectedRide: RideOption;
    customPrice?: string;
}

interface UpdateBookingRequest {
    status?: 'pending' | 'confirmed' | 'completed' | 'cancelled';
    customPrice?: string;
}

interface LocationAnalyticsRequest {
    userId: string;
    locationType: 'origin' | 'destination';
    locationData: LocationData;
}

interface SearchAnalyticsRequest {
    userId: string;
    query: string;
    resultsCount: number;
}

const app = new Elysia()
    .use(cors({
        origin: true, // Configure this for production
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }))
    .use(swagger({
        documentation: {
            info: {
                title: 'Ride Booking API',
                version: '1.0.0',
                description: 'Backend API for ride booking app with blockchain integration'
            },
            tags: [
                { name: 'Health', description: 'Health check endpoints' },
                { name: 'Rides', description: 'Ride booking operations' },
                { name: 'Analytics', description: 'Analytics and tracking' }
            ]
        }
    }))

    // Enhanced Health check with KV testing
    .get('/health', async ({ set }): Promise<ApiResponse> => {
        try {
            // Test KV connection
            const kvHealthy = await Database.testConnection();

            const health: ApiResponse = {
                status: kvHealthy ? 'ok' : 'degraded',
                timestamp: new Date().toISOString(),
                services: {
                    kv: kvHealthy ? 'healthy' : 'unhealthy',
                    server: 'healthy'
                }
            };

            if (!kvHealthy) {
                set.status = 503; // Service Unavailable
            }

            return health;
        } catch (error) {
            console.error('Health check failed:', error);
            set.status = 500;
            return {
                status: 'error',
                timestamp: new Date().toISOString(),
                error: 'Health check failed',
                services: {
                    kv: 'unknown',
                    server: 'error'
                }
            };
        }
    }, {
        detail: {
            tags: ['Health'],
            summary: 'Health check with service status',
            responses: {
                200: { description: 'All services healthy' },
                503: { description: 'Some services degraded' },
                500: { description: 'Health check failed' }
            }
        }
    })

    // Ride Booking Endpoints
    .post('/api/rides/book', async ({ body, set }): Promise<ApiResponse<RideBooking>> => {
        try {
            const requestBody = body as CreateBookingRequest;
            const { userId, origin, destination, selectedRide, customPrice } = requestBody;

            // Enhanced validation
            if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
                set.status = 400;
                return { error: 'Valid non-empty userId is required' };
            }

            if (!validateLocationData(origin)) {
                set.status = 400;
                return { error: 'Valid origin location with coordinates and address is required' };
            }

            if (!validateLocationData(destination)) {
                set.status = 400;
                return { error: 'Valid destination location with coordinates and address is required' };
            }

            if (!validateRideOption(selectedRide)) {
                set.status = 400;
                return { error: 'Valid ride option with all required fields is required' };
            }

            // Check if origin and destination are different
            if (origin.address === destination.address) {
                set.status = 400;
                return { error: 'Origin and destination cannot be the same' };
            }

            const booking = await Database.createRideBooking({
                userId,
                origin,
                destination,
                selectedRide,
                customPrice,
                status: 'pending'
            });

            // Track analytics in parallel (don't block response)
            Database.trackRideSelection(userId, selectedRide.id, customPrice)
                .catch(error => console.error('Analytics tracking failed:', error));

            return { success: true, booking };
        } catch (error) {
            console.error('Error creating ride booking:', error);
            set.status = 500;
            return { error: 'Failed to create booking. Please try again.' };
        }
    }, {
        detail: {
            tags: ['Rides'],
            summary: 'Create a new ride booking',
            description: 'Creates a new ride booking with the provided details'
        }
    })

    .get('/api/rides/:bookingId', async ({ params, set }): Promise<ApiResponse<RideBooking>> => {
        try {
            const { bookingId } = params;

            if (!bookingId || typeof bookingId !== 'string') {
                set.status = 400;
                return { error: 'Valid booking ID is required' };
            }

            const booking = await Database.getRideBooking(bookingId);
            if (!booking) {
                set.status = 404;
                return { error: 'Booking not found' };
            }
            return { booking };
        } catch (error) {
            console.error('Error fetching booking:', error);
            set.status = 500;
            return { error: 'Failed to fetch booking' };
        }
    }, {
        detail: {
            tags: ['Rides'],
            summary: 'Get ride booking by ID',
            description: 'Retrieves a specific ride booking by its ID'
        }
    })

    .patch('/api/rides/:bookingId', async ({ params, body, set }): Promise<ApiResponse<RideBooking>> => {
        try {
            const { bookingId } = params;
            const updates = body as UpdateBookingRequest;

            if (!bookingId || typeof bookingId !== 'string') {
                set.status = 400;
                return { error: 'Valid booking ID is required' };
            }

            // Validate status if provided
            if (updates.status && !['pending', 'confirmed', 'completed', 'cancelled'].includes(updates.status)) {
                set.status = 400;
                return { error: 'Invalid status. Must be: pending, confirmed, completed, or cancelled' };
            }

            // Type-safe updates object
            const safeUpdates: Partial<RideBooking> = {};
            if (updates.status) {
                safeUpdates.status = updates.status;
            }
            if (updates.customPrice !== undefined) {
                safeUpdates.customPrice = updates.customPrice;
            }

            const booking = await Database.updateRideBooking(bookingId, safeUpdates);

            if (!booking) {
                set.status = 404;
                return { error: 'Booking not found' };
            }

            return { success: true, booking };
        } catch (error) {
            console.error('Error updating booking:', error);
            set.status = 500;
            return { error: 'Failed to update booking' };
        }
    }, {
        detail: {
            tags: ['Rides'],
            summary: 'Update ride booking',
            description: 'Updates a ride booking status or custom price'
        }
    })

    .get('/api/users/:userId/rides', async ({ params, query, set }): Promise<ApiResponse<RideBooking[]>> => {
        try {
            const { userId } = params;

            if (!userId || typeof userId !== 'string') {
                set.status = 400;
                return { error: 'Valid user ID is required' };
            }

            const limitParam = query.limit as string | undefined;
            let limit = 10;

            if (limitParam) {
                const parsedLimit = parseInt(limitParam, 10);
                if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
                    set.status = 400;
                    return { error: 'Limit must be a number between 1 and 100' };
                }
                limit = parsedLimit;
            }

            const bookings = await Database.getUserBookings(userId, limit);
            return { bookings };
        } catch (error) {
            console.error('Error fetching user bookings:', error);
            set.status = 500;
            return { error: 'Failed to fetch bookings' };
        }
    }, {
        detail: {
            tags: ['Rides'],
            summary: 'Get user ride history',
            description: 'Retrieves ride booking history for a specific user'
        }
    })

    // Analytics Endpoints
    .post('/api/analytics/location-select', async ({ body, set }): Promise<ApiResponse> => {
        try {
            const requestBody = body as LocationAnalyticsRequest;
            const { userId, locationType, locationData } = requestBody;

            if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
                set.status = 400;
                return { error: 'Valid userId is required' };
            }

            if (!locationType || !['origin', 'destination'].includes(locationType)) {
                set.status = 400;
                return { error: 'Valid locationType (origin|destination) is required' };
            }

            if (!validateLocationData(locationData)) {
                set.status = 400;
                return { error: 'Valid location data is required' };
            }

            // Log for debugging/analytics
            console.log(`User ${userId} selected ${locationType}:`, locationData.address);

            return { success: true };
        } catch (error) {
            console.error('Error tracking location selection:', error);
            set.status = 500;
            return { error: 'Failed to track selection' };
        }
    }, {
        detail: {
            tags: ['Analytics'],
            summary: 'Track location selection',
            description: 'Tracks when a user selects an origin or destination'
        }
    })

    .post('/api/analytics/search', async ({ body, set }): Promise<ApiResponse> => {
        try {
            const requestBody = body as SearchAnalyticsRequest;
            const { userId, query, resultsCount } = requestBody;

            if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
                set.status = 400;
                return { error: 'Valid userId is required' };
            }

            if (!query || typeof query !== 'string' || query.trim().length === 0) {
                set.status = 400;
                return { error: 'Valid search query is required' };
            }

            if (typeof resultsCount !== 'number' || resultsCount < 0) {
                set.status = 400;
                return { error: 'Valid resultsCount (non-negative number) is required' };
            }

            await Database.trackLocationSearch(userId, query.trim(), resultsCount);
            return { success: true };
        } catch (error) {
            console.error('Error tracking search:', error);
            set.status = 500;
            return { error: 'Failed to track search' };
        }
    }, {
        detail: {
            tags: ['Analytics'],
            summary: 'Track search queries',
            description: 'Tracks user search queries and result counts'
        }
    })

    // Error handling middleware
    .onError(({ error, set }) => {
        console.error('Unhandled error:', error);

        // Handle different error types
        if (error instanceof Error) {
            if (error.message.includes('JSON')) {
                set.status = 400;
                return { error: 'Invalid JSON in request body' };
            }

            if (error.message.includes('validation')) {
                set.status = 400;
                return { error: 'Validation error' };
            }
        }

        // Handle Elysia-specific errors
        if (typeof error === 'object' && error !== null && 'status' in error) {
            const elysiaError = error as { status: number; message?: string };
            set.status = elysiaError.status;
            return { error: elysiaError.message || 'Request error' };
        }

        set.status = 500;
        return { error: 'Internal server error' };
    })

    .listen({
        port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
        hostname: process.env.HOST || '0.0.0.0'
    });

console.log(`🚗 Ride booking server is running on ${process.env.HOST || '0.0.0.0'}:${app.server?.port}`);
console.log(`📚 API documentation available at: http://${process.env.HOST || 'localhost'}:${app.server?.port}/swagger`);

export default app;