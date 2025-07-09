
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';

// Types
export interface User {
    id: string;
    email: string;
    username: string;
    walletAddress?: string;
    createdAt: string;
    updatedAt: string;
}

// Helper function to create username from email
function createUsernameFromEmail(email: string): string {
    const username = email.split('@')[0];
    // Clean up username (remove special chars except dots and underscores)
    // @ts-ignore
    return username.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase();
}

const app = new Elysia()
    .use(cors())
    .get('/health', () => ({
        status: 'OK',
        timestamp: new Date().toISOString(),
    }))

    // Check if user exists
    .post('/api/users/check', async ({ body }: { body: { email: string } }) => {
        try {
            const { email } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Check if user exists
            const existingUser = await kv.get<User>(`user:${email}`);

            if (existingUser) {
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
    .post('/api/users/create', async ({ body }: { body: { email: string; walletAddress?: string } }) => {
        try {
            const { email, walletAddress } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Check if user already exists
            const existingUser = await kv.get<User>(`user:${email}`);
            if (existingUser) {
                return {
                    error: 'User already exists',
                    status: 400,
                };
            }

            // Create new user
            const userId = uuidv4();
            const username = createUsernameFromEmail(email);
            const now = new Date().toISOString();

            const newUser: User = {
                id: userId,
                email,
                username,
                walletAddress,
                createdAt: now,
                updatedAt: now,
            };

            // Store user in KV
            await kv.set(`user:${email}`, newUser);

            // Also store by ID for quick lookups
            await kv.set(`user:id:${userId}`, newUser);

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
    .put('/api/users/update', async ({ body }: { body: { email: string; walletAddress?: string; username?: string } }) => {
        try {
            const { email, walletAddress, username } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Get existing user
            const existingUser = await kv.get<User>(`user:${email}`);
            if (!existingUser) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            // Update user
            const updatedUser: User = {
                ...existingUser,
                ...(walletAddress && { walletAddress }),
                ...(username && { username }),
                updatedAt: new Date().toISOString(),
            };

            // Update in KV
            await kv.set(`user:${email}`, updatedUser);
            await kv.set(`user:id:${existingUser.id}`, updatedUser);

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
    .get('/api/users/:id', async ({ params }: { params: { id: string } }) => {
        try {
            const { id } = params;

            const user = await kv.get<User>(`user:id:${id}`);

            if (!user) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

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
    .get('/api/users/email/:email', async ({ params }: { params: { email: string } }) => {
        try {
            const { email } = params;

            const user = await kv.get<User>(`user:${decodeURIComponent(email)}`);

            if (!user) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

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
    .get('/api/users', async () => {
        try {
            // This is a simple implementation - in production, you'd want pagination
            // and proper admin authentication
            const keys = await kv.keys('user:*');
            const emailKeys = keys.filter(key => !key.includes('user:id:'));

            const users = await Promise.all(
                emailKeys.map(async (key) => {
                    return await kv.get<User>(key);
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
    .delete('/api/users/:id', async ({ params }: { params: { id: string } }) => {
        try {
            const { id } = params;

            // Get user first to find email
            const user = await kv.get<User>(`user:id:${id}`);

            if (!user) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            // Delete both keys
            await kv.del(`user:${user.email}`);
            await kv.del(`user:id:${id}`);

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
    })

    .listen(3001);

console.log(`🦊 Elysia is running at http://localhost:3001`);
console.log(`Health check: http://localhost:3001/health`);

export default app;