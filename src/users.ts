import { Elysia } from 'elysia';
import { v4 as uuidv4 } from 'uuid';
import type { User } from './types';
import type { Sql } from 'postgres';

export function createUsernameFromEmail(email: string): string {
    const username = email.split('@')[0];
    return username.replace(/[^a-zA-Z0-9._]/g, '').toLowerCase();
}

export const userRoutes = new Elysia({ prefix: '/api/users' })
    // Check if user exists
    .post('/check', async ({ body, db }: { body: { email: string }; db: Sql }) => {
        try {
            const { email } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Check if user exists
            const users = await db`
                SELECT * FROM users WHERE email = ${email}
            `;

            if (users.length > 0) {
                const existingUser = users[0];
                
                // Check if user is also a driver
                let driverId = null;
                let isDriver = existingUser.is_driver || false;
                
                try {
                    const drivers = await db`
                        SELECT id, status FROM drivers WHERE email = ${email}
                    `;
                    if (drivers.length > 0 && drivers[0].status === 'approved') {
                        isDriver = true;
                        driverId = drivers[0].id;
                    }
                } catch (driverError) {
                    console.log('No driver record found for user:', email);
                }
                
                const userWithDriverInfo: User = {
                    id: existingUser.id,
                    email: existingUser.email,
                    username: existingUser.username,
                    walletAddress: existingUser.wallet_address,
                    isDriver,
                    driverId,
                    createdAt: existingUser.created_at,
                    updatedAt: existingUser.updated_at,
                };
                
                return {
                    exists: true,
                    user: userWithDriverInfo
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
    .post('/create', async ({ body, db }: { body: { email: string; walletAddress?: string; username?: string }; db: Sql }) => {
        try {
            const { email, walletAddress, username } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Check if user already exists
            const existing = await db`
                SELECT id FROM users WHERE email = ${email}
            `;
            
            if (existing.length > 0) {
                return {
                    error: 'User already exists',
                    status: 400,
                };
            }

            // Create new user
            const userId = uuidv4();
            const finalUsername = username || createUsernameFromEmail(email);
            const now = new Date().toISOString();

            await db`
                INSERT INTO users (id, email, username, wallet_address, created_at, updated_at)
                VALUES (${userId}, ${email}, ${finalUsername}, ${walletAddress || null}, ${now}, ${now})
            `;

            const newUser: User = {
                id: userId,
                email,
                username: finalUsername,
                walletAddress,
                createdAt: now,
                updatedAt: now,
            };

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
    .put('/update', async ({ body, db }: { body: { email: string; walletAddress?: string; username?: string }; db: Sql }) => {
        try {
            const { email, walletAddress, username } = body;

            if (!email) {
                return {
                    error: 'Email is required',
                    status: 400,
                };
            }

            // Get existing user
            const existing = await db`
                SELECT * FROM users WHERE email = ${email}
            `;
            
            if (existing.length === 0) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            const now = new Date().toISOString();

            // Update user
            await db`
                UPDATE users 
                SET 
                    ${walletAddress !== undefined ? db`wallet_address = ${walletAddress},` : db``}
                    ${username !== undefined ? db`username = ${username},` : db``}
                    updated_at = ${now}
                WHERE email = ${email}
            `;

            const updated = await db`
                SELECT * FROM users WHERE email = ${email}
            `;

            const updatedUser: User = {
                id: updated[0].id,
                email: updated[0].email,
                username: updated[0].username,
                walletAddress: updated[0].wallet_address,
                isDriver: updated[0].is_driver,
                driverId: updated[0].driver_id,
                createdAt: updated[0].created_at,
                updatedAt: updated[0].updated_at,
            };

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
    .get('/:id', async ({ params, db }: { params: { id: string }; db: Sql }) => {
        try {
            const { id } = params;

            const users = await db`
                SELECT * FROM users WHERE id = ${id}
            `;

            if (users.length === 0) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            const user: User = {
                id: users[0].id,
                email: users[0].email,
                username: users[0].username,
                walletAddress: users[0].wallet_address,
                isDriver: users[0].is_driver,
                driverId: users[0].driver_id,
                createdAt: users[0].created_at,
                updatedAt: users[0].updated_at,
            };

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
    .get('/email/:email', async ({ params, db }: { params: { email: string }; db: Sql }) => {
        try {
            const { email } = params;

            const users = await db`
                SELECT * FROM users WHERE email = ${decodeURIComponent(email)}
            `;

            if (users.length === 0) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

            const user: User = {
                id: users[0].id,
                email: users[0].email,
                username: users[0].username,
                walletAddress: users[0].wallet_address,
                isDriver: users[0].is_driver,
                driverId: users[0].driver_id,
                createdAt: users[0].created_at,
                updatedAt: users[0].updated_at,
            };

            return { user };

        } catch (error) {
            console.error('Error fetching user:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Get all users (for admin purposes)
    .get('/', async ({ db }: { db: Sql }) => {
        try {
            const results = await db`
                SELECT * FROM users ORDER BY created_at DESC
            `;

            const users: User[] = results.map(row => ({
                id: row.id,
                email: row.email,
                username: row.username,
                walletAddress: row.wallet_address,
                isDriver: row.is_driver,
                driverId: row.driver_id,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            }));

            return { users };

        } catch (error) {
            console.error('Error fetching users:', error);
            return {
                error: 'Internal server error',
                status: 500,
            };
        }
    })

    // Delete user
    .delete('/:id', async ({ params, db }: { params: { id: string }; db: Sql }) => {
        try {
            const { id } = params;

            const result = await db`
                DELETE FROM users WHERE id = ${id} RETURNING id
            `;

            if (result.length === 0) {
                return {
                    error: 'User not found',
                    status: 404,
                };
            }

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
