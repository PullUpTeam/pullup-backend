export interface User {
    id: string;
    email: string;
    username: string;
    phoneNumber?: string;
    walletAddress?: string;
    createdAt: string;
    updatedAt: string;
}

// Coordinates interface
export interface Coordinates {
    latitude: number;
    longitude: number;
}

// Ride interface - Enhanced with driver assignment fields
export interface Ride {
    id: string;
    userId: string;
    userEmail: string;
    walletAddress?: string;

    // Location data
    originCoordinates: Coordinates;
    destinationCoordinates: Coordinates;
    originAddress: string;
    destinationAddress: string;

    // Pricing
    estimatedPrice?: string;
    customPrice?: string;
    finalPrice?: string;

    // Driver information (added after assignment)
    driverId?: string;
    driverName?: string;
    driverVehicle?: string;
    driverPhone?: string;
    driverLocation?: Coordinates;

    // Status and timestamps
    status: 'pending' | 'auctioning' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';
    scheduledTime?: string;
    notes?: string;
    acceptedAt?: string;
    startedAt?: string;
    completedAt?: string;
    cancelledAt?: string;
    createdAt: string;
    updatedAt: string;
}

// Driver interface
export interface Driver {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    address?: string;
    licenseNumber: string;
    vehicleModel: string;
    vehicleYear?: number | string;
    vehiclePlate: string;
    motivation?: string;
    status: 'pending' | 'approved' | 'rejected' | 'suspended';
    availability: 'offline' | 'online_free' | 'online_busy';
    currentRideId?: string;

    // Location tracking
    latitude?: number;
    longitude?: number;
    heading?: number;
    speed?: number;
    lastLocationUpdate?: string;

    // Timestamps
    applicationDate: string;
    approvalDate?: string;
    rejectionReason?: string;
    createdAt: string;
    updatedAt: string;
}

// Driver application request
export interface DriverApplicationRequest {
    fullName: string;
    email: string;
    phoneNumber: string;
    address?: string;
    licenseNumber: string;
    vehicleModel: string;
    vehicleYear?: number | string;
    vehiclePlate: string;
    motivation?: string;
}

// Driver update request
export interface DriverUpdateRequest {
    id: string;
    fullName?: string;
    email?: string;
    phoneNumber?: string;
    address?: string;
    licenseNumber?: string;
    vehicleModel?: string;
    vehicleYear?: number | string;
    vehiclePlate?: string;
    motivation?: string;
    status?: 'pending' | 'approved' | 'rejected' | 'suspended';
    availability?: 'offline' | 'online_free' | 'online_busy';
}

// Driver availability update
export interface DriverAvailabilityUpdate {
    driverId: string;
    availability: 'offline' | 'online_free' | 'online_busy';
    currentRideId?: string;
    latitude?: number;
    longitude?: number;
}

// Location tracking
export interface LocationUpdate {
    latitude: number;
    longitude: number;
    heading?: number;
    speed?: number;
    timestamp: string;
}

// WebSocket message types
export interface WSMessage {
    type: string;
    [key: string]: any;
}

export interface DriverLocationMessage extends WSMessage {
    type: 'driverLocationUpdate';
    rideId: string;
    driverId?: string;
    location: LocationUpdate;
}

export interface DriverAssignedMessage extends WSMessage {
    type: 'driverAssigned';
    rideId: string;
    driverId: string;
    driver: {
        id: string;
        name: string;
        vehicle: string;
        phone: string;
        location: Coordinates;
    };
}

export interface RideStatusMessage extends WSMessage {
    type: 'rideStatusUpdate';
    rideId: string;
    status: Ride['status'];
}

export interface RideCreatedMessage extends WSMessage {
    type: 'rideCreated';
    ride: Ride;
}

export interface ConnectionMessage extends WSMessage {
    type: 'connected';
    message: string;
    wsId?: string;
}

export interface SubscriptionMessage extends WSMessage {
    type: 'subscribeToRide' | 'unsubscribeFromRide';
    rideId: string;
}

export interface IdentificationMessage extends WSMessage {
    type: 'identifyUser' | 'identifyDriver';
    userId?: string;
    driverId?: string;
}

// Trip params for frontend
export interface TripParams {
    rideId?: string;
    price: string;
    pickupAddress: string;
    destinationAddress: string;
    driverName?: string;
    driverVehicle?: string;
    driverPhone?: string;
}

// Trip status enum for frontend
export type TripStatus =
    | 'Waiting for Driver'
    | 'Driver Assigned'
    | 'Approaching Pickup'
    | 'Driver Arrived'
    | 'Trip Started'
    | 'In Progress'
    | 'Trip Completed'
    | 'Trip Cancelled';

// Tracking response
export interface TrackingResponse {
    ride: {
        id: string;
        status: Ride['status'];
        origin: Coordinates;
        destination: Coordinates;
        originAddress: string;
        destinationAddress: string;
        driver: {
            id: string;
            name: string;
            vehicle: string;
            phone: string;
        } | null;
    };
    currentLocation: LocationUpdate | null;
    locationHistory: LocationUpdate[];
    lastUpdate: string | null;
}

// Auto-assign response
export interface AutoAssignResponse {
    success: boolean;
    assignedDriver?: {
        id: string;
        name: string;
        distance: number;
    };
    error?: string;
}

// Driver stats
export interface DriverStats {
    availability: {
        offline: number;
        online_free: number;
        online_busy: number;
        total: number;
    };
}

// WebSocket stats
export interface WSStats {
    totalConnections: number;
    connections: Array<{
        id?: string;
        type: 'passenger' | 'driver' | 'unknown';
        subscribedRides: string[];
        userId?: string;
        driverId?: string;
    }>;
}

// API Response types
export interface SuccessResponse<T = any> {
    success: true;
    data?: T;
    message?: string;
}

export interface ErrorResponse {
    success: false;
    error: string;
    status: number;
}

export type ApiResponse<T = any> = SuccessResponse<T> | ErrorResponse;