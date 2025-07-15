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

export interface Driver {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    address: string;
    licenseNumber: string;
    vehicleModel: string;
    vehicleYear: string;
    vehiclePlate: string;
    motivation?: string;
    status: 'pending' | 'approved' | 'rejected' | 'suspended';
    availability: 'offline' | 'online_free' | 'online_busy';
    currentRideId?: string;
    lastLocationUpdate?: string;
    latitude?: number;
    longitude?: number;
    applicationDate: string;
    approvalDate?: string;
    createdAt: string;
    updatedAt: string;
}

export interface DriverApplicationRequest {
    fullName: string;
    email: string;
    phoneNumber: string;
    address: string;
    licenseNumber: string;
    vehicleModel: string;
    vehicleYear: string;
    vehiclePlate: string;
    motivation?: string;
}

export interface DriverUpdateRequest {
    id: string;
    fullName?: string;
    email?: string;
    phoneNumber?: string;
    address?: string;
    licenseNumber?: string;
    vehicleModel?: string;
    vehicleYear?: string;
    vehiclePlate?: string;
    motivation?: string;
    status?: 'pending' | 'approved' | 'rejected' | 'suspended';
}

export interface DriverAvailabilityUpdate {
    driverId: string;
    availability: 'offline' | 'online_free' | 'online_busy';
    currentRideId?: string;
    latitude?: number;
    longitude?: number;
}