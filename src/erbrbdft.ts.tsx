const { ethers } = require('ethers');
const axios = require('axios');

class RideAuctionService {
    constructor(contractAddress, privateKey, providerUrl) {
        this.provider = new ethers.JsonRpcProvider(providerUrl);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
        this.contract = new ethers.Contract(contractAddress, ABI, this.wallet);

        this.activeRides = new Map(); // Track active auctions
        this.driverLocations = new Map(); // Cache driver locations

        this.setupEventListeners();
        this.startAuctionMonitoring();
    }

    // 1. PASSENGER REQUESTS RIDE
    async createRide(passengerAddress, rideData) {
        console.log('🚗 Creating ride for passenger:', passengerAddress);

        try {
            // Create ride on-chain with LOW starting price
            const tx = await this.contract.createSimple(
                rideData.pickupLocation,    // "Rynek Główny, Kraków"
                rideData.destination,       // "Lotnisko Balice"
                ethers.parseEther("20"),    // 20 USDC starting price (LOW!)
                rideData.distance,          // 15000 meters
                rideData.carType,           // 0 (standard)
                rideData.passengerCount     // 2
            );

            const receipt = await tx.wait();
            const rideId = this.extractRideId(receipt);

            console.log(`✅ Ride created with ID: ${rideId}`);

            // Add to monitoring
            this.activeRides.set(rideId, {
                passengerAddress,
                rideData,
                startTime: Date.now(),
                lastProcessed: Date.now()
            });

            return rideId;

        } catch (error) {
            console.error('❌ Failed to create ride:', error);
            throw error;
        }
    }

    // 2. MONITOR ACTIVE AUCTIONS
    startAuctionMonitoring() {
        setInterval(async () => {
            for (const [rideId, rideInfo] of this.activeRides) {
                await this.processRideAuction(rideId, rideInfo);
            }
        }, 12000); // Check every 12 seconds (slightly more than 10s price interval)
    }

    async processRideAuction(rideId, rideInfo) {
        try {
            console.log(`🔄 Processing auction for ride ${rideId}`);

            // Get current ride status from blockchain
            const [passenger, currentPrice, assigned, driver] = await this.contract.getRide(rideId);

            if (assigned) {
                console.log(`✅ Ride ${rideId} already assigned to ${driver}`);
                this.activeRides.delete(rideId);
                return;
            }

            console.log(`💰 Current price: ${ethers.formatEther(currentPrice)} USDC`);

            // Get eligible drivers from contract
            const eligibleCount = await this.contract.getEligibleCount(rideId);
            console.log(`👥 Eligible drivers: ${eligibleCount}`);

            if (eligibleCount > 0) {
                // Find best driver using off-chain intelligence
                const bestDriver = await this.findBestDriver(rideId, rideInfo.rideData);

                if (bestDriver) {
                    await this.assignDriver(rideId, bestDriver);
                    return;
                }
            }

            // If no driver found, let the price increase naturally
            console.log(`⏳ No suitable driver yet, letting auction continue...`);

        } catch (error) {
            console.error(`❌ Error processing ride ${rideId}:`, error);
        }
    }

    // 3. OFF-CHAIN INTELLIGENCE - Find closest driver
    async findBestDriver(rideId, rideData) {
        console.log(`🎯 Finding best driver for ride ${rideId}`);

        try {
            // Get all eligible drivers from contract
            const eligibleDrivers = await this.getAllEligibleDrivers(rideId);

            if (eligibleDrivers.length === 0) {
                return null;
            }

            console.log(`👥 Found ${eligibleDrivers.length} eligible drivers`);

            // Calculate distances for each eligible driver
            const driversWithDistances = await Promise.all(
                eligibleDrivers.map(async (driverAddress) => {
                    const distance = await this.calculateDistance(
                        driverAddress,
                        rideData.pickupLocation
                    );

                    return {
                        address: driverAddress,
                        distance: distance
                    };
                })
            );

            // Sort by distance (closest first)
            driversWithDistances.sort((a, b) => a.distance - b.distance);

            const bestDriver = driversWithDistances[0];
            console.log(`🏆 Best driver: ${bestDriver.address} (${bestDriver.distance}m away)`);

            return bestDriver.address;

        } catch (error) {
            console.error('❌ Error finding best driver:', error);
            return null;
        }
    }

    // 4. GET ELIGIBLE DRIVERS (simulated - would iterate through driver list)
    async getAllEligibleDrivers(rideId) {
        // In real implementation, you'd iterate through all registered drivers
        // and check eligibility. For demo, we'll simulate this:

        const allDrivers = await this.getAllRegisteredDrivers();
        const eligible = [];

        for (const driverAddress of allDrivers) {
            const isEligible = await this.contract.isEligible(rideId, driverAddress);
            if (isEligible) {
                eligible.push(driverAddress);
            }
        }

        return eligible;
    }

    // 5. CALCULATE DISTANCE using Google Maps API
    async calculateDistance(driverAddress, pickupLocation) {
        try {
            // Get driver's current location from your database
            const driverLocation = this.driverLocations.get(driverAddress);

            if (!driverLocation) {
                console.log(`⚠️ No location data for driver ${driverAddress}`);
                return Infinity; // Exclude driver if no location
            }

            // Use Google Maps Distance Matrix API
            const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
                params: {
                    origins: `${driverLocation.lat},${driverLocation.lng}`,
                    destinations: pickupLocation,
                    units: 'metric',
                    key: process.env.GOOGLE_MAPS_API_KEY
                }
            });

            const distance = response.data.rows[0].elements[0].distance.value; // meters
            const duration = response.data.rows[0].elements[0].duration.value; // seconds

            console.log(`📍 Driver ${driverAddress}: ${distance}m away, ${duration}s drive time`);

            return distance;

        } catch (error) {
            console.error(`❌ Error calculating distance for ${driverAddress}:`, error);
            return Infinity;
        }
    }

    // 6. ASSIGN SPECIFIC DRIVER
    async assignDriver(rideId, driverAddress) {
        try {
            console.log(`🎯 Assigning driver ${driverAddress} to ride ${rideId}`);

            // Double-check eligibility before assignment
            const isEligible = await this.contract.isEligible(rideId, driverAddress);
            if (!isEligible) {
                console.log(`❌ Driver ${driverAddress} no longer eligible`);
                return false;
            }

            // Call smart contract to assign specific driver
            const tx = await this.contract.assign(rideId, driverAddress);
            const receipt = await tx.wait();

            console.log(`✅ Driver assigned! Transaction: ${receipt.hash}`);

            // Remove from active monitoring
            this.activeRides.delete(rideId);

            // Notify passenger and driver
            await this.notifyAssignment(rideId, driverAddress);

            return true;

        } catch (error) {
            console.error(`❌ Failed to assign driver:`, error);
            return false;
        }
    }

    // 7. EVENT LISTENERS for blockchain events
    setupEventListeners() {
        // Listen for new rides
        this.contract.on('RideStart', (rideId, event) => {
            console.log(`🆕 New ride created: ${rideId}`);
        });

        // Listen for price increases
        this.contract.on('PriceUp', (rideId, newPrice, event) => {
            console.log(`📈 Price increased for ride ${rideId}: ${ethers.formatEther(newPrice)} USDC`);
        });

        // Listen for assignments
        this.contract.on('Assigned', (rideId, driver, event) => {
            console.log(`🎉 Ride ${rideId} assigned to ${driver}`);
            this.activeRides.delete(rideId);
        });
    }

    // 8. DRIVER LOCATION TRACKING
    async updateDriverLocation(driverAddress, lat, lng) {
        // Store in local cache for distance calculations
        this.driverLocations.set(driverAddress, { lat, lng, timestamp: Date.now() });

        console.log(`📍 Updated location for driver ${driverAddress}: ${lat}, ${lng}`);
    }

    // 9. NOTIFICATION SYSTEM
    async notifyAssignment(rideId, driverAddress) {
        // Get ride and driver details
        const [passenger, finalPrice, assigned, driver] = await this.contract.getRide(rideId);

        // Notify passenger
        await this.sendNotification(passenger, {
            type: 'DRIVER_ASSIGNED',
            rideId: rideId,
            driverAddress: driverAddress,
            finalPrice: ethers.formatEther(finalPrice),
            message: `Driver found! Final price: ${ethers.formatEther(finalPrice)} USDC`
        });

        // Notify driver
        await this.sendNotification(driverAddress, {
            type: 'RIDE_ASSIGNED',
            rideId: rideId,
            passengerAddress: passenger,
            finalPrice: ethers.formatEther(finalPrice),
            message: `You won the auction! Pick up passenger for ${ethers.formatEther(finalPrice)} USDC`
        });
    }

    async sendNotification(userAddress, notification) {
        // Implement your notification system (push notifications, email, SMS, etc.)
        console.log(`📧 Notification to ${userAddress}:`, notification.message);
    }

    // Helper functions
    extractRideId(receipt) {
        const event = receipt.logs.find(log => log.eventName === 'RideStart');
        return event.args[0];
    }

    async getAllRegisteredDrivers() {
        // In real implementation, you'd maintain a list of registered drivers
        // or query events from the contract
        return ['0x123...', '0x456...', '0x789...']; // Placeholder
    }
}

// USAGE EXAMPLE
async function main() {
    const service = new RideAuctionService(
        '0x...', // contract address
        process.env.PRIVATE_KEY,
        'https://ethereum-mainnet.alchemyapi.io/v2/your-key'
    );

    // Example: Passenger requests ride
    const rideId = await service.createRide('0xpassenger...', {
        pickupLocation: 'Rynek Główny, Kraków',
        destination: 'Lotnisko Balice',
        distance: 15000,
        carType: 0,
        passengerCount: 2
    });

    console.log(`🚀 Service started, monitoring ride ${rideId}`);
}

// Export for use in your application
module.exports = { RideAuctionService };