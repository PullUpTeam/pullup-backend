import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { Database } from './database';
import { validateLocationData, validateRideOption } from './validation';
import type { LocationData, RideOption } from './types';

const app = new Elysia()
    .use(cors())
    .use(swagger({
        documentation: {
            info: {
                title: 'Ride Booking API',
                version: '1.0.0',
                description: 'Backend API for ride booking app'
            }
        }
    }))

    // Health check
    .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

    // Ride Booking Endpoints
    .post('/api/rides/book', async ({ body, set }) => {
        try {
            const { userId, origin, destination, selectedRide, customPrice } = body as {
                userId: string;
                origin: LocationData;
                destination: LocationData;
                selectedRide: RideOption;
                customPrice?: string;
            };

            // Validation
            if (!userId || typeof userId !== 'string') {
                set.status = 400;
                return { error: 'Valid userId is required' };
            }

            if (!validateLocationData(origin)) {
                set.status = 400;
                return { error: 'Valid origin location is required' };
            }

            if (!validateLocationData(destination)) {
                set.status = 400;
                return { error: 'Valid destination location is required' };
            }

            if (!validateRideOption(selectedRide)) {
                set.status = 400;
                return { error: 'Valid ride option is required' };
            }

            const booking = await Database.createRideBooking({
                userId,
                origin,
                destination,
                selectedRide,
                customPrice,
                status: 'pending'
            });

            // Track analytics
            await Database.trackRideSelection(userId, selectedRide.id, customPrice);

            return { success: true, booking };
        } catch (error) {
            console.error('Error creating ride booking:', error);
            set.status = 500;
            return { error: 'Failed to create booking' };
        }
    })

    .get('/api/rides/:bookingId', async ({ params, set }) => {
        try {
            const booking = await Database.getRideBooking(params.bookingId);
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
    })

    .patch('/api/rides/:bookingId', async ({ params, body, set }) => {
        try {
            const updates = body as Partial<{ status: string; customPrice: string }>;
            const booking = await Database.updateRideBooking(params.bookingId, updates);

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
    })

    .get('/api/users/:userId/rides', async ({ params, query, set }) => {
        try {
            const limit = query.limit ? parseInt(query.limit as string) : 10;
            const bookings = await Database.getUserBookings(params.userId, limit);
            return { bookings };
        } catch (error) {
            console.error('Error fetching user bookings:', error);
            set.status = 500;
            return { error: 'Failed to fetch bookings' };
        }
    })

    // User Preferences endpoints removed - keeping local only

    // Location Selection Tracking
    .post('/api/analytics/location-select', async ({ body, set }) => {
        try {
            const { userId, locationType, locationData } = body as {
                userId: string;
                locationType: 'origin' | 'destination';
                locationData: LocationData;
            };

            if (!userId || !locationType || !validateLocationData(locationData)) {
                set.status = 400;
                return { error: 'Valid data is required' };
            }

            // You can add more detailed analytics here
            console.log(`User ${userId} selected ${locationType}:`, locationData.address);

            return { success: true };
        } catch (error) {
            console.error('Error tracking location selection:', error);
            set.status = 500;
            return { error: 'Failed to track selection' };
        }
    })

    // Search Analytics
    .post('/api/analytics/search', async ({ body, set }) => {
        try {
            const { userId, query, resultsCount } = body as {
                userId: string;
                query: string;
                resultsCount: number;
            };

            if (!userId || !query) {
                set.status = 400;
                return { error: 'UserId and query are required' };
            }

            await Database.trackLocationSearch(userId, query, resultsCount || 0);
            return { success: true };
        } catch (error) {
            console.error('Error tracking search:', error);
            set.status = 500;
            return { error: 'Failed to track search' };
        }
    })

    .listen(process.env.PORT || 3000);

console.log(`🚗 Ride booking server is running on port ${app.server?.port}`);

export default app;