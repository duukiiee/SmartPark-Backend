import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export const adminParkingRoutes = Router();

// Protect all admin parking routes with Auth and Admin/Super Admin role
adminParkingRoutes.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

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
 * 1. GET /api/admin/parking/overview
 * Real-time occupancy statistics and breakdown
 */
adminParkingRoutes.get("/overview", async (req, res, next) => {
  try {
    const setting = await getOrCreateParkingSetting();
    const { carCapacity, motorcycleCapacity } = setting;
    const totalCapacity = carCapacity + motorcycleCapacity;

    // Count currently parked vehicles (physically occupying a parking space)
    const carParked = await db.parkingLog.count({
      where: {
        OR: [{ status: "Currently Parked" }, { exitTime: null }],
        vehicle: {
          type: "Car",
        },
      },
    });

    const motorcycleParked = await db.parkingLog.count({
      where: {
        OR: [{ status: "Currently Parked" }, { exitTime: null }],
        vehicle: {
          type: "Motorcycle",
        },
      },
    });

    const totalOccupied = carParked + motorcycleParked;
    const availableSpaces = Math.max(0, totalCapacity - totalOccupied);
    const occupancyRate = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

    const carAvailable = Math.max(0, carCapacity - carParked);
    const carOccupancyRate = carCapacity > 0 ? Math.round((carParked / carCapacity) * 100) : 0;

    const motorcycleAvailable = Math.max(0, motorcycleCapacity - motorcycleParked);
    const motorcycleOccupancyRate = motorcycleCapacity > 0 ? Math.round((motorcycleParked / motorcycleCapacity) * 100) : 0;

    return res.status(200).json({
      success: true,
      data: {
        totalCapacity,
        totalOccupied,
        availableSpaces,
        occupancyRate,
        cars: {
          capacity: carCapacity,
          parked: carParked,
          available: carAvailable,
          occupancyRate: carOccupancyRate,
        },
        motorcycles: {
          capacity: motorcycleCapacity,
          parked: motorcycleParked,
          available: motorcycleAvailable,
          occupancyRate: motorcycleOccupancyRate,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/admin/parking/capacity
 * Get configurable parking capacities & current utilization
 */
adminParkingRoutes.get("/capacity", async (req, res, next) => {
  try {
    const setting = await getOrCreateParkingSetting();
    const { carCapacity, motorcycleCapacity } = setting;
    const totalCapacity = carCapacity + motorcycleCapacity;

    const carParked = await db.parkingLog.count({
      where: {
        OR: [{ status: "Currently Parked" }, { exitTime: null }],
        vehicle: {
          type: "Car",
        },
      },
    });

    const motorcycleParked = await db.parkingLog.count({
      where: {
        OR: [{ status: "Currently Parked" }, { exitTime: null }],
        vehicle: {
          type: "Motorcycle",
        },
      },
    });

    const totalOccupied = carParked + motorcycleParked;
    const utilizationPercentage = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

    return res.status(200).json({
      success: true,
      data: {
        carCapacity,
        motorcycleCapacity,
        totalCapacity,
        carParked,
        motorcycleParked,
        totalOccupied,
        utilizationPercentage,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. PUT /api/admin/parking/capacity
 * Update car and motorcycle parking capacity
 */
adminParkingRoutes.put("/capacity", async (req, res, next) => {
  try {
    const { carCapacity, motorcycleCapacity } = req.body;

    const parsedCar = parseInt(carCapacity, 10);
    const parsedMoto = parseInt(motorcycleCapacity, 10);

    if (isNaN(parsedCar) || parsedCar <= 0) {
      return res.status(400).json({
        success: false,
        message: "Car capacity must be a positive whole number greater than 0.",
        field: "car",
      });
    }

    if (isNaN(parsedMoto) || parsedMoto <= 0) {
      return res.status(400).json({
        success: false,
        message: "Motorcycle capacity must be a positive whole number greater than 0.",
        field: "motorcycle",
      });
    }

    let setting = await db.parkingSetting.findFirst();
    if (!setting) {
      setting = await db.parkingSetting.create({
        data: {
          carCapacity: parsedCar,
          motorcycleCapacity: parsedMoto,
        },
      });
    } else {
      setting = await db.parkingSetting.update({
        where: { id: setting.id },
        data: {
          carCapacity: parsedCar,
          motorcycleCapacity: parsedMoto,
        },
      });
    }

    const totalCapacity = setting.carCapacity + setting.motorcycleCapacity;

    return res.status(200).json({
      success: true,
      message: "Parking capacity updated successfully.",
      data: {
        carCapacity: setting.carCapacity,
        motorcycleCapacity: setting.motorcycleCapacity,
        totalCapacity,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. GET /api/admin/parking/history
 * Comprehensive parking audit logs with filters and pagination
 */
adminParkingRoutes.get("/history", async (req, res, next) => {
  try {
    const search = (req.query.search as string)?.trim() || "";
    const vehicleType = (req.query.type as string)?.trim() || "All";
    const dateFilter = (req.query.date as string)?.trim() || "All Dates";
    const statusFilter = (req.query.status as string)?.trim() || "All";
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const skip = (page - 1) * limit;

    // Helper functions for date/time formatting
    const formatDate = (date: Date) =>
      date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const formatTime = (date: Date) =>
      date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

    // Build efficient Prisma WHERE clause
    const where: any = {};

    if (vehicleType !== "All") {
      where.vehicle = { ...(where.vehicle || {}), type: vehicleType };
    }

    if (statusFilter !== "All") {
      where.status = statusFilter;
    }

    if (search) {
      where.OR = [
        { vehicle: { plateNumber: { contains: search, mode: "insensitive" } } },
        { vehicle: { brand: { contains: search, mode: "insensitive" } } },
        { vehicle: { model: { contains: search, mode: "insensitive" } } },
        { vehicle: { user: { firstName: { contains: search, mode: "insensitive" } } } },
        { vehicle: { user: { lastName: { contains: search, mode: "insensitive" } } } },
        { guardName: { contains: search, mode: "insensitive" } },
      ];
    }

    if (dateFilter !== "All Dates") {
      const parsedDate = new Date(dateFilter);
      if (!isNaN(parsedDate.getTime())) {
        const startOfDay = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
        const endOfDay = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate() + 1);
        where.entryTime = { gte: startOfDay, lt: endOfDay };
      }
    }

    // Parallel fetch: total count, paginated records, and distinct date samples
    const [total, paginatedSlice, recentDateLogs] = await Promise.all([
      db.parkingLog.count({ where }),
      db.parkingLog.findMany({
        where,
        include: {
          vehicle: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  schoolId: true,
                  email: true,
                },
              },
            },
          },
        },
        orderBy: { entryTime: "desc" },
        skip,
        take: limit,
      }),
      db.parkingLog.findMany({
        select: { entryTime: true },
        orderBy: { entryTime: "desc" },
        take: 50,
      }),
    ]);

    // Unique dates from recent logs for filter dropdown
    const availableDatesSet = new Set<string>();
    recentDateLogs.forEach((log) => {
      if (log.entryTime) availableDatesSet.add(formatDate(log.entryTime));
    });
    const availableDates = ["All Dates", ...Array.from(availableDatesSet)];

    const totalPages = Math.ceil(total / limit) || 1;

    const formattedHistory = paginatedSlice.map((log) => {
      const v = log.vehicle;
      let durationStr = log.duration || "--";

      if (log.entryTime && log.exitTime && (!log.duration || log.duration === "--")) {
        const diffMs = log.exitTime.getTime() - log.entryTime.getTime();
        if (diffMs > 0) {
          const hours = Math.floor(diffMs / (1000 * 60 * 60));
          const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          durationStr = `${hours}h ${minutes}m`;
        }
      }

      return {
        id: log.id,
        date: formatDate(log.entryTime),
        rawEntryTime: log.entryTime.toISOString(),
        rawExitTime: log.exitTime ? log.exitTime.toISOString() : null,
        vehicleName: `${v.brand} ${v.model}`,
        type: v.type,
        plateNo: v.plateNumber,
        entryTime: formatTime(log.entryTime),
        exitTime: log.exitTime ? formatTime(log.exitTime) : "--",
        duration: durationStr,
        status: log.status,
        guardName: log.guardName || "Guard Santos",
        ownerName: v.user ? `${v.user.firstName} ${v.user.lastName}` : "--",
      };
    });

    return res.status(200).json({
      success: true,
      history: formattedHistory,
      availableDates,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. GET /api/admin/parking/analytics
 * Real-time access analytics and vehicle distribution
 */
adminParkingRoutes.get("/analytics", async (req, res, next) => {
  try {
    const now = new Date();
    const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const past7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Vehicles entering in past 24 hours
    const vehiclesEntering24h = await db.parkingLog.count({
      where: {
        entryTime: { gte: past24h },
      },
    });

    // Vehicles exiting in past 24 hours
    const vehiclesExiting24h = await db.parkingLog.count({
      where: {
        exitTime: { gte: past24h },
      },
    });

    // Total registered vehicles
    const totalCarsRegistered = await db.vehicle.count({
      where: { type: "Car" },
    });
    const totalMotorcyclesRegistered = await db.vehicle.count({
      where: { type: "Motorcycle" },
    });
    const totalVehicles = totalCarsRegistered + totalMotorcyclesRegistered;

    // Peak parking hour estimate from recent logs
    const recentLogs = await db.parkingLog.findMany({
      where: {
        entryTime: { gte: past7Days },
      },
      select: {
        entryTime: true,
      },
    });

    // Count by hour
    const hourCounts: { [hour: number]: number } = {};
    recentLogs.forEach((log) => {
      const hour = new Date(log.entryTime).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    let peakHour = 10; // Default 10:00 AM
    let maxHourCount = 0;
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > maxHourCount) {
        maxHourCount = count;
        peakHour = parseInt(hour, 10);
      }
    }

    const peakHourFormatted = `${peakHour % 12 === 0 ? 12 : peakHour % 12}:00 ${peakHour >= 12 ? "PM" : "AM"}`;

    // Weekly distribution (past 7 days Mon-Sun)
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklyCounts: { [day: string]: number } = {
      Mon: 0,
      Tue: 0,
      Wed: 0,
      Thu: 0,
      Fri: 0,
      Sat: 0,
      Sun: 0,
    };

    recentLogs.forEach((log) => {
      const dayIndex = new Date(log.entryTime).getDay();
      const day = dayNames[dayIndex];
      if (day && typeof weeklyCounts[day] === "number") {
        weeklyCounts[day] += 1;
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        vehiclesEntering24h,
        vehiclesExiting24h,
        peakParkingHour: peakHourFormatted,
        distribution: {
          cars: totalCarsRegistered,
          motorcycles: totalMotorcyclesRegistered,
          total: totalVehicles,
          carPercentage: totalVehicles > 0 ? Math.round((totalCarsRegistered / totalVehicles) * 100) : 50,
          motorcyclePercentage: totalVehicles > 0 ? Math.round((totalMotorcyclesRegistered / totalVehicles) * 100) : 50,
        },
        weeklyUtilization: weeklyCounts,
      },
    });
  } catch (err) {
    next(err);
  }
});
