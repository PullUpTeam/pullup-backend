import type {LocationData, RideOption, PlaceResult} from "./types.ts";
export const validateLocationData = (data: any): data is LocationData => {
    return (
        data &&
        typeof data.address === 'string' &&
        data.coordinates &&
        typeof data.coordinates.latitude === 'number' &&
        typeof data.coordinates.longitude === 'number'
    );
};

export const validateRideOption = (data: any): data is RideOption => {
    return (
        data &&
        typeof data.id === 'number' &&
        typeof data.name === 'string' &&
        typeof data.estimatedTime === 'string' &&
        typeof data.basePrice === 'number' &&
        typeof data.vehicleType === 'string'
    );
};

export const validatePlaceResult = (data: any): data is PlaceResult => {
    return (
        data &&
        typeof data.id === 'string' &&
        typeof data.title === 'string'
    );
};
