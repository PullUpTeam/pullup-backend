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

export interface Ride {
    id: string;
    userId: string;
    userEmail: string;
    walletAddress: string;
    originCoordinates: Coordinates;
    destinationCoordinates: Coordinates;
    originAddress: string;
    destinationAddress: string;
    estimatedPrice?: string;
    customPrice?: string;
    status: 'pending' | 'accepted' | 'driver_assigned' | 'approaching_pickup' | 'driver_arrived' | 'in_progress' | 'completed' | 'cancelled'; // ✅ Updated statuses
    assignedDriverId?: string;    // ✅ Added missing field
    driverAcceptedAt?: string;    // ✅ Added missing field
    createdAt: string;
    updatedAt: string;
}

export interface FullDriver {
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
    rejectionReason?: string;
    createdAt: string;
    updatedAt: string;
    username?: string;
    walletAddress?: string;
    isDriver?: boolean;
}

export interface Driver {
    id: string;
    email: string;
    username: string;
    walletAddress?: string;
    isDriver: boolean;
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

export interface DriverLocation {
    driverId: string;
    latitude: number;
    longitude: number;
    heading?: number;
    speed?: number;
    accuracy?: number;
    timestamp: string;
}

export function toSimpleDriver(fullDriver: FullDriver): Driver {
    return {
        id: fullDriver.id,
        email: fullDriver.email,
        username: fullDriver.fullName, // Map fullName to username
        walletAddress: fullDriver.walletAddress,
        isDriver: fullDriver.status === 'approved', // Driver is active if approved
        createdAt: fullDriver.createdAt,
        updatedAt: fullDriver.updatedAt,
    };
}