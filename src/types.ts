export interface LocationData {
    coordinates: {
        latitude: number;
        longitude: number;
    };
    address: string;
    isCurrentLocation?: boolean;
}

export interface PlaceResult {
    id: string;
    title: string;
    subtitle?: string;
    fullAddress?: string;
    coordinates?: {
        latitude: number;
        longitude: number;
    };
}

export interface RideOption {
    id: number;
    name: string;
    estimatedTime: string;
    basePrice: number;
    description?: string;
    vehicleType: string;
}

export interface RideBooking {
    id: string;
    userId: string;
    origin: LocationData;
    destination: LocationData;
    selectedRide: RideOption;
    customPrice?: string;
    status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
    createdAt: string;
    updatedAt: string;
}