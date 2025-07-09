// database.ts - Enhanced version with better error handling
import { kv } from '@vercel/kv';
import type { RideBooking } from "./types";

export class Database {
    // Test connection
    static async testConnection(): Promise<boolean> {
        try {
            await kv.set('test', 'connection');
            await kv.del('test');
            return true;
        } catch (error) {
            console.error('KV connection failed:', error);
            return false;
        }
    }

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

        try {
            await kv.set(`booking:${id}`, newBooking);
            await kv.zadd(`user:${booking.userId}:bookings`, { score: Date.now(), member: id });
            return newBooking;
        } catch (error) {
            console.error('Failed to create ride booking:', error);
            throw new Error('Database operation failed');
        }
    }

    static async getRideBooking(bookingId: string): Promise<RideBooking | null> {
        try {
            return await kv.get(`booking:${bookingId}`);
        } catch (error) {
            console.error('Failed to get ride booking:', error);
            return null;
        }
    }

    static async updateRideBooking(bookingId: string, updates: Partial<RideBooking>): Promise<RideBooking | null> {
        try {
            const existing = await this.getRideBooking(bookingId);
            if (!existing) return null;

            const updated: RideBooking = {
                ...existing,
                ...updates,
                updatedAt: new Date().toISOString()
            };

            await kv.set(`booking:${bookingId}`, updated);
            return updated;
        } catch (error) {
            console.error('Failed to update ride booking:', error);
            return null;
        }
    }

    static async getUserBookings(userId: string, limit = 10): Promise<RideBooking[]> {
        try {
            const bookingIds = await kv.zrange(`user:${userId}:bookings`, 0, limit - 1, { rev: true });
            const bookings: RideBooking[] = [];

            for (const id of bookingIds) {
                const booking = await this.getRideBooking(id as string);
                if (booking) bookings.push(booking);
            }

            return bookings;
        } catch (error) {
            console.error('Failed to get user bookings:', error);
            return [];
        }
    }

    // Analytics
    static async trackLocationSearch(userId: string, query: string, results: number): Promise<void> {
        try {
            const timestamp = Date.now();
            await kv.zadd('analytics:searches', {
                score: timestamp,
                member: JSON.stringify({
                    userId,
                    query,
                    results,
                    timestamp
                })
            });
        } catch (error) {
            console.error('Failed to track location search:', error);
        }
    }

    static async trackRideSelection(userId: string, rideId: number, customPrice?: string): Promise<void> {
        try {
            const timestamp = Date.now();
            await kv.zadd('analytics:ride_selections', {
                score: timestamp,
                member: JSON.stringify({
                    userId,
                    rideId,
                    customPrice,
                    timestamp
                })
            });
        } catch (error) {
            console.error('Failed to track ride selection:', error);
        }
    }

    // Cleanup old analytics (optional)
    static async cleanupOldAnalytics(daysToKeep = 30): Promise<void> {
        try {
            const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
            await kv.zremrangebyscore('analytics:searches', 0, cutoff);
            await kv.zremrangebyscore('analytics:ride_selections', 0, cutoff);
        } catch (error) {
            console.error('Failed to cleanup old analytics:', error);
        }
    }
}