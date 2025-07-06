import { kv } from '@vercel/kv';
import type {RideBooking} from "./types.ts";

export class Database {
    // Ride Bookings
    static async createRideBooking(booking: Omit<RideBooking, 'id' | 'createdAt' | 'updatedAt'>): Promise<RideBooking> {
        const id = `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString();

        const newBooking: RideBooking = {
            ...booking,
            id,
            createdAt: timestamp,
            updatedAt: timestamp
        };

        await kv.set(`booking:${id}`, newBooking);
        await kv.zadd(`user:${booking.userId}:bookings`, Date.now(), id);

        return newBooking;
    }

    static async getRideBooking(bookingId: string): Promise<RideBooking | null> {
        return await kv.get(`booking:${bookingId}`);
    }

    static async updateRideBooking(bookingId: string, updates: Partial<RideBooking>): Promise<RideBooking | null> {
        const existing = await this.getRideBooking(bookingId);
        if (!existing) return null;

        const updated: RideBooking = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await kv.set(`booking:${bookingId}`, updated);
        return updated;
    }

    static async getUserBookings(userId: string, limit = 10): Promise<RideBooking[]> {
        const bookingIds = await kv.zrevrange(`user:${userId}:bookings`, 0, limit - 1);
        const bookings: RideBooking[] = [];

        for (const id of bookingIds) {
            const booking = await this.getRideBooking(id as string);
            if (booking) bookings.push(booking);
        }

        return bookings;
    }

    // User Preferences removed - keeping local only

    // Analytics
    static async trackLocationSearch(userId: string, query: string, results: number): Promise<void> {
        const timestamp = Date.now();
        await kv.zadd('analytics:searches', timestamp, JSON.stringify({
            userId,
            query,
            results,
            timestamp
        }));
    }

    static async trackRideSelection(userId: string, rideId: number, customPrice?: string): Promise<void> {
        const timestamp = Date.now();
        await kv.zadd('analytics:ride_selections', timestamp, JSON.stringify({
            userId,
            rideId,
            customPrice,
            timestamp
        }));
    }
}