import { Elysia } from 'elysia';
import { v4 as uuidv4 } from 'uuid';
import type { User } from './types';

export function createUsernameFromEmail(email: string): string {
    const username = email.split('@')[0];
    // @ts-ignore
    return username.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase();
}

export const userRoutes = new Elysia({ prefix: '/api/users' })
    // Check if user exists
    .post('/check', async ({ body, redis }: { body: { email: string }; redis: any }) => {
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
    .post('/create', async ({ body, redis }: { body: { email: string; walletAddress?: string; username?: string }; redis: any }) => {
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
    .put('/update', async ({ body, redis }: { body: { email: string; walletAddress?: string; username?: string }; redis: any }) => {
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
    .get('/:id', async ({ params, redis }: { params: { id: string }; redis: any }) => {
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
    .get('/email/:email', async ({ params, redis }: { params: { email: string }; redis: any }) => {
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
    .get('/', async ({ redis }: { redis: any }) => {
        try {
            // This is a simple implementation - in production, you'd want pagination
            // and proper admin authentication
            const keys = await redis.keys('user:*');
            const emailKeys = keys.filter((key: string) => !key.includes('user:id:'));

            const users = await Promise.all(
                emailKeys.map(async (key: string) => {
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
    .delete('/:id', async ({ params, redis }: { params: { id: string }; redis: any }) => {
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
    });