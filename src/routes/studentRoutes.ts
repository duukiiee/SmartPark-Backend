import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

export const studentRoutes = Router();

// Student routes are protected by Auth
studentRoutes.use(requireAuth);

/**
 * Format date/time helper for activity logs
 */
function formatHistoryDate(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = months[date.getMonth()];
  const d = date.getDate();
  const y = date.getFullYear();

  let h = date.getHours();
  const min = date.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  h = h ? h : 12;

  return `${m} ${d}, ${y} • ${h}:${min} ${ampm}`;
}

/**
 * Helper to ensure a ParkingSetting record exists
 */
async function getOrCreateParkingSetting() {
  let setting = await db.parkingSetting.findFirst();
  if (!setting) {
    setting = await db.parkingSetting.create({
      data: {
        carCapacity: 60,
        motorcycleCapacity: 40,
      },
    });
  }
  return setting;
}

/**
 * 1. GET /api/student/dashboard
 * Live metrics for StudentHome.tsx:
 * - Real-time parking overview (occupied, available, totalCapacity, rate, level)
 * - User's registered vehicles count
 * - User's recent parking activities (entries / exits for their own vehicles)
 */
studentRoutes.get("/dashboard", async (req, res, next) => {
  try {
    const userId = req.user!.id;

    // 1. Live parking capacity & occupancy
    const setting = await getOrCreateParkingSetting();
    const totalCapacity = setting.carCapacity + setting.motorcycleCapacity;

    const [activeCars, activeMotorcycles] = await Promise.all([
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
          vehicle: { type: "Car" },
        },
      }),
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
          vehicle: { type: "Motorcycle" },
        },
      }),
    ]);

    const occupied = activeCars + activeMotorcycles;
    const available = Math.max(0, totalCapacity - occupied);
    const occupancyRate = totalCapacity > 0 ? Math.round((occupied / totalCapacity) * 100) : 0;

    let availabilityLevel: "High" | "Moderate" | "Limited" | "Full" = "High";
    if (occupancyRate >= 95) availabilityLevel = "Full";
    else if (occupancyRate >= 75) availabilityLevel = "Limited";
    else if (occupancyRate >= 45) availabilityLevel = "Moderate";

    // 2. User's registered vehicles count
    const vehiclesCount = await db.vehicle.count({
      where: {
        userId,
        status: { not: "Inactive" },
      },
    });

    // 3. User's recent vehicle parking logs
    const userVehicles = await db.vehicle.findMany({
      where: { userId },
      select: { id: true, plateNumber: true, brand: true, model: true, color: true, type: true },
    });

    const userVehicleIds = userVehicles.map((v) => v.id);

    let recentHistory: any[] = [];
    if (userVehicleIds.length > 0) {
      const logs = await db.parkingLog.findMany({
        where: { vehicleId: { in: userVehicleIds } },
        include: { vehicle: true },
        orderBy: { entryTime: "desc" },
        take: 5,
      });

      recentHistory = logs.map((log) => {
        const vehicle = log.vehicle;
        const vehicleTitle = vehicle ? `${vehicle.brand} ${vehicle.model} (${vehicle.plateNumber})` : "Vehicle";
        const isExit = !!log.exitTime;
        const eventDate = isExit && log.exitTime ? new Date(log.exitTime) : new Date(log.entryTime);

        return {
          id: `${log.id}-${isExit ? "exit" : "entry"}`,
          vehicleTitle,
          plateNumber: vehicle?.plateNumber || "N/A",
          dateTime: formatHistoryDate(eventDate),
          action: isExit ? "EXIT" : "ENTRANCE",
          status: log.status,
        };
      });
    }

    return res.status(200).json({
      success: true,
      parkingOverview: {
        occupied,
        available,
        totalCapacity,
        occupancyRate,
        availabilityLevel,
        remainingSlots: available,
      },
      vehiclesCount,
      recentHistory,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/student/parking & /api/parking/overview
 * Real-time breakdown for Parking.tsx:
 * - Cars vs. Motorcycles parked, capacity, and percentage
 */
studentRoutes.get(["/", "/overview", "/parking"], async (req, res, next) => {
  try {
    const setting = await getOrCreateParkingSetting();
    const { carCapacity, motorcycleCapacity } = setting;
    const totalCapacity = carCapacity + motorcycleCapacity;

    const [carsParked, motorcycleParked] = await Promise.all([
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
          vehicle: { type: "Car" },
        },
      }),
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
          vehicle: { type: "Motorcycle" },
        },
      }),
    ]);

    const occupied = carsParked + motorcycleParked;
    const available = Math.max(0, totalCapacity - occupied);
    const occupancyRatio = totalCapacity > 0 ? occupied / totalCapacity : 0;

    const carsPercentage = carCapacity > 0 ? `${((carsParked / carCapacity) * 100).toFixed(1)}%` : "0%";
    const motorcyclePercentage = motorcycleCapacity > 0 ? `${((motorcycleParked / motorcycleCapacity) * 100).toFixed(1)}%` : "0%";

    return res.status(200).json({
      success: true,
      overview: {
        occupied,
        totalCapacity,
        available,
        occupancyRatio,
        carsCount: carsParked,
        carsCapacity: carCapacity,
        carsPercentage,
        motorcycleCount: motorcycleParked,
        motorcycleCapacity,
        motorcyclePercentage,
      },
    });
  } catch (err) {
    next(err);
  }
});
