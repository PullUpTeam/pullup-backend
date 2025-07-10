// User interface
export interface User {
    id: string;
    email: string;
    username: string;
    walletAddress?: string;
    createdAt: string;
    updatedAt: string;
}

// Coordinates interface
export interface Coordinates {
    latitude: number;
    longitude: number;
}

// Ride interface
export interface Ride {
    id: string;
    userId: string;
    walletAddress: string;
    userEmail: string;
    originCoordinates: Coordinates;
    destinationCoordinates: Coordinates;
    originAddress: string;
    destinationAddress: string;
    estimatedPrice?: string;
    customPrice?: string;
    status: 'pending' | 'auctioning' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
    createdAt: string;
    updatedAt: string;
}