import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export const guardRoutes = Router();

// Allow Guards, Admins, and Super Admins to access Guard monitoring endpoints
guardRoutes.use(requireAuth, requireRole("GUARD", "ADMIN", "SUPER_ADMIN"));

function formatTimeOnly(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatHistoryDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDuration(start: Date, end: Date): string {
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const totalMins = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hours}h ${mins}m`;
}

/**
 * 1. GET /api/guard/monitoring
 * Returns live records for Recent Entries, Recent Exits, Currently Inside, and Access History
 */
guardRoutes.get("/monitoring", async (req, res, next) => {
  try {
    const tab = ((req.query.tab as string) || "entries").toLowerCase(); // "entries" | "exits" | "inside" | "history"
    const search = ((req.query.search as string) || "").trim().toLowerCase();
    const vehicleTypeFilter =
      (req.query.vehicleType as string) || "All Vehicle";
    const dateFilter = (req.query.date as string) || ""; // "YYYY-MM-DD"
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const skip = (page - 1) * limit;

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    // Live Metrics for today
    const [todayEntries, todayExits, currentlyInside] = await Promise.all([
      db.parkingLog.count({
        where: { entryTime: { gte: startOfToday } },
      }),
      db.parkingLog.count({
        where: { exitTime: { gte: startOfToday } },
      }),
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
        },
      }),
    ]);

    let rawRecords: any[] = [];

    if (tab === "history") {
      // Historical discrete events (ENTRY and EXIT)
      const allLogs = await db.parkingLog.findMany({
        take: 200,
        include: {
          vehicle: {
            include: {
              user: {
                select: { firstName: true, lastName: true, schoolId: true },
              },
            },
          },
        },
        orderBy: { entryTime: "desc" },
      });

      const events: any[] = [];
      allLogs.forEach((log) => {
        let owner = "Gate Visitor";
        if (log.vehicle?.registrationSource === "Gate") {
          if (log.vehicle?.rejectionReason) {
            try {
              const meta = JSON.parse(log.vehicle.rejectionReason);
              if (meta.ownerName && meta.ownerName.trim())
                owner = meta.ownerName.trim();
            } catch {}
          }
        } else if (log.vehicle?.user) {
          owner =
            `${log.vehicle.user.firstName} ${log.vehicle.user.lastName}`.trim();
        }
        const plate = log.vehicle?.plateNumber || "N/A";
        const vType = (
          log.vehicle?.type === "Motorcycle" ? "Motorcycle" : "Car"
        ) as "Car" | "Motorcycle";

        // Entry event
        if (log.entryTime) {
          const eDate = new Date(log.entryTime);
          events.push({
            id: `${log.id}-entry`,
            owner,
            plate,
            vehicleType: vType,
            action: "ENTRY",
            timeOrDate: formatHistoryDate(eDate),
            rawDate: eDate.toISOString().split("T")[0],
            result: "GRANTED",
            timestamp: eDate.getTime(),
          });
        }

        // Exit event
        if (log.exitTime) {
          const xDate = new Date(log.exitTime);
          events.push({
            id: `${log.id}-exit`,
            owner,
            plate,
            vehicleType: vType,
            action: "EXIT",
            timeOrDate: formatHistoryDate(xDate),
            rawDate: xDate.toISOString().split("T")[0],
            result: "GRANTED",
            timestamp: xDate.getTime(),
          });
        }
      });

      // Sort newest events first
      events.sort((a, b) => b.timestamp - a.timestamp);
      rawRecords = events;
    } else if (tab === "exits") {
      // Recent Exits
      const logs = await db.parkingLog.findMany({
        where: { exitTime: { not: null } },
        take: 200,
        include: {
          vehicle: {
            include: {
              user: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { exitTime: "desc" },
      });

      rawRecords = logs.map((log) => {
        const exitDate = new Date(log.exitTime!);
        const entryDate = new Date(log.entryTime);
        let owner = "Gate Visitor";
        if (log.vehicle?.registrationSource === "Gate") {
          if (log.vehicle?.rejectionReason) {
            try {
              const meta = JSON.parse(log.vehicle.rejectionReason);
              if (meta.ownerName && meta.ownerName.trim())
                owner = meta.ownerName.trim();
            } catch {}
          }
        } else if (log.vehicle?.user) {
          owner =
            `${log.vehicle.user.firstName} ${log.vehicle.user.lastName}`.trim();
        }
        const plate = log.vehicle?.plateNumber || "N/A";
        const vType = (
          log.vehicle?.type === "Motorcycle" ? "Motorcycle" : "Car"
        ) as "Car" | "Motorcycle";
        const duration = log.duration || formatDuration(entryDate, exitDate);

        return {
          id: String(log.id),
          owner,
          plate,
          vehicleType: vType,
          timeOrDate: formatTimeOnly(exitDate),
          rawDate: exitDate.toISOString().split("T")[0],
          duration,
          guard: log.guardName || "Guard Santos",
        };
      });
    } else if (tab === "inside") {
      // Currently Inside
      const logs = await db.parkingLog.findMany({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
        },
        take: 200,
        include: {
          vehicle: {
            include: {
              user: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { entryTime: "desc" },
      });

      rawRecords = logs.map((log) => {
        const entryDate = new Date(log.entryTime);
        let owner = "Gate Visitor";
        if (log.vehicle?.registrationSource === "Gate") {
          if (log.vehicle?.rejectionReason) {
            try {
              const meta = JSON.parse(log.vehicle.rejectionReason);
              if (meta.ownerName && meta.ownerName.trim())
                owner = meta.ownerName.trim();
            } catch {}
          }
        } else if (log.vehicle?.user) {
          owner =
            `${log.vehicle.user.firstName} ${log.vehicle.user.lastName}`.trim();
        }
        const plate = log.vehicle?.plateNumber || "N/A";
        const vType = (
          log.vehicle?.type === "Motorcycle" ? "Motorcycle" : "Car"
        ) as "Car" | "Motorcycle";

        return {
          id: String(log.id),
          owner,
          plate,
          vehicleType: vType,
          timeOrDate: formatTimeOnly(entryDate),
          rawDate: entryDate.toISOString().split("T")[0],
          guard: log.guardName || "Guard Santos",
        };
      });
    } else {
      // Default: "entries"
      const logs = await db.parkingLog.findMany({
        take: 200,
        include: {
          vehicle: {
            include: {
              user: {
                select: { firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { entryTime: "desc" },
      });

      rawRecords = logs.map((log) => {
        const entryDate = new Date(log.entryTime);
        let owner = "Gate Visitor";
        if (log.vehicle?.registrationSource === "Gate") {
          if (log.vehicle?.rejectionReason) {
            try {
              const meta = JSON.parse(log.vehicle.rejectionReason);
              if (meta.ownerName && meta.ownerName.trim())
                owner = meta.ownerName.trim();
            } catch {}
          }
        } else if (log.vehicle?.user) {
          owner =
            `${log.vehicle.user.firstName} ${log.vehicle.user.lastName}`.trim();
        }
        const plate = log.vehicle?.plateNumber || "N/A";
        const vType = (
          log.vehicle?.type === "Motorcycle" ? "Motorcycle" : "Car"
        ) as "Car" | "Motorcycle";
        const registrationSource =
          log.vehicle?.registrationSource?.toLowerCase() === "gate"
            ? "Gate registration"
            : "User registration";

        return {
          id: String(log.id),
          owner,
          plate,
          vehicleType: vType,
          timeOrDate: formatTimeOnly(entryDate),
          rawDate: entryDate.toISOString().split("T")[0],
          registrationSource,
          guard: log.guardName || "Guard Santos",
        };
      });
    }

    // Apply Client-Requested Filters (Search, Vehicle Type, Date)
    const filteredRecords = rawRecords.filter((item) => {
      // 1. Search Query
      if (search) {
        const matchesSearch =
          (item.owner && item.owner.toLowerCase().includes(search)) ||
          (item.plate && item.plate.toLowerCase().includes(search)) ||
          (item.guard && item.guard.toLowerCase().includes(search)) ||
          (item.vehicleType && item.vehicleType.toLowerCase().includes(search));
        if (!matchesSearch) return false;
      }

      // 2. Vehicle Type Filter
      if (vehicleTypeFilter && vehicleTypeFilter !== "All Vehicle") {
        if (item.vehicleType !== vehicleTypeFilter) return false;
      }

      // 3. Date Filter
      if (dateFilter && item.rawDate) {
        if (item.rawDate !== dateFilter) return false;
      }

      return true;
    });

    const total = filteredRecords.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginatedRecords = filteredRecords.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      tab,
      metrics: {
        entriesToday: todayEntries,
        exitsToday: todayExits,
        currentlyInside,
      },
      records: paginatedRecords,
      allFilteredRecords: filteredRecords, // Handy for full CSV export
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
 * 2. GET /api/guard/dashboard
 * Aggregated live metrics and recent activity for the Guard Dashboard
 */
guardRoutes.get("/dashboard", async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const [
      todayEntries,
      todayExits,
      currentlyInside,
      unreadNotifications,
      setting,
    ] = await Promise.all([
      db.parkingLog.count({ where: { entryTime: { gte: startOfToday } } }),
      db.parkingLog.count({ where: { exitTime: { gte: startOfToday } } }),
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
        },
      }),
      db.notification.count({
        where: {
          read: false,
          NOT: [
            {
              title: {
                contains: "Vehicle Registration Pending",
                mode: "insensitive",
              },
            },
            {
              title: {
                contains: "New Vehicle Registration",
                mode: "insensitive",
              },
            },
            { title: { contains: "New Incident Report", mode: "insensitive" } },
            {
              title: { contains: "New Suspension Appeal", mode: "insensitive" },
            },
          ],
          OR: [
            { link: { contains: "/guard" } },
            { title: { contains: "Parking", mode: "insensitive" } },
            { title: { contains: "Pass Approved", mode: "insensitive" } },
            { title: { contains: "Gate", mode: "insensitive" } },
            { type: "warning" },
          ],
        },
      }),
      db.parkingSetting.findFirst(),
    ]);

    const totalCapacity = setting
      ? setting.carCapacity + setting.motorcycleCapacity
      : 96;

    // Latest 10 activities (both entries and exits)
    const logs = await db.parkingLog.findMany({
      take: 10,
      include: {
        vehicle: true,
      },
      orderBy: { entryTime: "desc" },
    });

    const recentActivities: any[] = [];
    logs.forEach((log) => {
      const plateNo = log.vehicle?.plateNumber || "N/A";
      const type = log.vehicle?.type || "Car";

      if (log.exitTime) {
        recentActivities.push({
          id: `${log.id}-exit`,
          plateNo,
          type,
          action: "EXIT",
          time: formatHistoryDate(new Date(log.exitTime)),
          timestamp: new Date(log.exitTime).getTime(),
        });
      }
      if (log.entryTime) {
        recentActivities.push({
          id: `${log.id}-entry`,
          plateNo,
          type,
          action: "ENTRY",
          time: formatHistoryDate(new Date(log.entryTime)),
          timestamp: new Date(log.entryTime).getTime(),
        });
      }
    });

    recentActivities.sort((a, b) => b.timestamp - a.timestamp);

    return res.status(200).json({
      success: true,
      metrics: {
        vehiclesInside: currentlyInside,
        totalCapacity,
        entriesToday: todayEntries,
        exitsToday: todayExits,
        unreadNotifications,
      },
      recentActivities: recentActivities.slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. POST /api/guard/scan
 * Validates a vehicle by plate number or QR code for entry / exit
 */
guardRoutes.post("/scan", async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({
        success: false,
        message: "Plate number or QR code is required",
      });
    }

    const trimmed = code.trim();
    const cleanPlate = trimmed.replace(/[^A-Za-z0-9]/g, "");

    let vehicle = await db.vehicle.findFirst({
      where: {
        OR: [
          { plateNumber: { equals: trimmed, mode: "insensitive" } },
          { plateNumber: { equals: cleanPlate, mode: "insensitive" } },
          { qrCode: { equals: trimmed } },
          { qrCode: { equals: cleanPlate } },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            schoolId: true,
            role: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!vehicle && cleanPlate.length >= 3) {
      const candidates = await db.vehicle.findMany({
        where: {
          OR: [
            {
              plateNumber: {
                contains: cleanPlate.slice(0, 3),
                mode: "insensitive",
              },
            },
            {
              plateNumber: {
                contains: cleanPlate.slice(-3),
                mode: "insensitive",
              },
            },
            { qrCode: { contains: cleanPlate } },
          ],
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              schoolId: true,
              role: true,
              email: true,
              phone: true,
            },
          },
        },
        take: 20,
      });

      vehicle =
        candidates.find((v) => {
          const vPlate = (v.plateNumber || "")
            .replace(/[^A-Za-z0-9]/g, "")
            .toUpperCase();
          const vQr = (v.qrCode || "")
            .replace(/[^A-Za-z0-9]/g, "")
            .toUpperCase();
          const cleanUpper = cleanPlate.toUpperCase();
          return vPlate === cleanUpper || vQr === cleanUpper;
        }) || null;
    }

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        reason: "INVALID_QR",
        message: "No vehicle matches this QR code or plate number.",
      });
    }

    let ownerName = vehicle.user
      ? `${vehicle.user.firstName} ${vehicle.user.lastName}`
      : "Campus Visitor / Guest";
    let schoolId = vehicle.user?.schoolId || "N/A";
    let role = vehicle.user?.role || "Visitor";
    let email = vehicle.user?.email || "N/A";
    let phone = vehicle.user?.phone || "N/A";

    if (vehicle.registrationSource === "Gate" && vehicle.rejectionReason) {
      try {
        const meta = JSON.parse(vehicle.rejectionReason);
        if (meta.ownerName) ownerName = meta.ownerName;
        if (meta.idNumber) schoolId = meta.idNumber;
        if (meta.idType) role = `Visitor (${meta.idType})`;
      } catch {
        // ignore
      }
    }

    if (vehicle.status !== "Approved") {
      return res.status(400).json({
        success: false,
        reason: "NOT_APPROVED",
        message: `Vehicle is currently ${vehicle.status}. Only approved vehicles may enter.`,
        vehicle: {
          id: vehicle.id,
          plateNumber: vehicle.plateNumber,
          model: `${vehicle.brand} ${vehicle.model}`,
          ownerName,
          schoolId,
        },
      });
    }

    // Check if vehicle is currently parked inside
    const activeLog = await db.parkingLog.findFirst({
      where: {
        vehicleId: vehicle.id,
        exitTime: null,
      },
      orderBy: { entryTime: "desc" },
    });

    return res.status(200).json({
      success: true,
      vehicle: {
        id: vehicle.id,
        plateNumber: vehicle.plateNumber,
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        year: vehicle.year,
        ownerName,
        schoolId,
        role,
        email,
        phone,
        photo: vehicle.photo || null,
        registrationSource: vehicle.registrationSource || "Online",
        approvedAt: vehicle.approvedAt,
      },
      isCurrentlyParked: !!activeLog,
      activeLog: activeLog
        ? {
            id: activeLog.id,
            entryTime: activeLog.entryTime,
            formattedEntryTime: formatHistoryDate(
              new Date(activeLog.entryTime),
            ),
            duration: formatDuration(new Date(activeLog.entryTime), new Date()),
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. POST /api/guard/record-entry
 * Records an entry into the parkingLog table
 */
guardRoutes.post("/record-entry", async (req, res, next) => {
  try {
    const { vehicleId } = req.body;
    if (!vehicleId) {
      return res.status(400).json({
        success: false,
        message: "Vehicle ID is required.",
      });
    }

    // Check if vehicle is already inside
    const activeLog = await db.parkingLog.findFirst({
      where: { vehicleId: Number(vehicleId), exitTime: null },
    });

    if (activeLog) {
      return res.status(400).json({
        success: false,
        message: "Vehicle is already recorded as inside campus.",
      });
    }

    // Check parking capacity before recording entry
    const [setting, currentlyInside] = await Promise.all([
      db.parkingSetting.findFirst(),
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
        },
      }),
    ]);

    const totalCapacity = setting
      ? setting.carCapacity + setting.motorcycleCapacity
      : 100;
    if (currentlyInside >= totalCapacity) {
      return res.status(400).json({
        success: false,
        message: "Parking lot is at full capacity. Entry denied.",
      });
    }

    // Resolve Guard Name from req.user
    let guardName = "Security Guard";
    if (req.user?.id) {
      const guardUser = await db.user.findUnique({
        where: { id: req.user.id },
      });
      if (guardUser) {
        guardName =
          `${guardUser.firstName} ${guardUser.lastName}`.trim() ||
          guardUser.email;
      }
    }

    const log = await db.parkingLog.create({
      data: {
        vehicleId: Number(vehicleId),
        entryTime: new Date(),
        status: "Currently Parked",
        guardName,
      },
      include: {
        vehicle: {
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: "Vehicle entry recorded successfully.",
      log: {
        id: log.id,
        plateNumber: log.vehicle.plateNumber,
        model: `${log.vehicle.brand} ${log.vehicle.model}`,
        owner: log.vehicle.user
          ? `${log.vehicle.user.firstName} ${log.vehicle.user.lastName}`
          : "Gate Visitor",
        entryTime: formatHistoryDate(log.entryTime),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. POST /api/guard/record-exit
 * Records an exit into the parkingLog table and computes duration
 */
guardRoutes.post("/record-exit", async (req, res, next) => {
  try {
    const { vehicleId } = req.body;
    if (!vehicleId) {
      return res.status(400).json({
        success: false,
        message: "Vehicle ID is required.",
      });
    }

    const activeLog = await db.parkingLog.findFirst({
      where: { vehicleId: Number(vehicleId), exitTime: null },
      orderBy: { entryTime: "desc" },
    });

    if (!activeLog) {
      return res.status(400).json({
        success: false,
        message: "No active entry record found for this vehicle.",
      });
    }

    const now = new Date();
    const duration = formatDuration(new Date(activeLog.entryTime), now);

    let guardName = activeLog.guardName;
    if (req.user?.id) {
      const guardUser = await db.user.findUnique({
        where: { id: req.user.id },
      });
      if (guardUser) {
        guardName =
          `${guardUser.firstName} ${guardUser.lastName}`.trim() ||
          guardUser.email;
      }
    }

    const updatedLog = await db.parkingLog.update({
      where: { id: activeLog.id },
      data: {
        exitTime: now,
        duration,
        status: "Complete",
        guardName,
      },
      include: {
        vehicle: {
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle exit recorded successfully.",
      log: {
        id: updatedLog.id,
        plateNumber: updatedLog.vehicle.plateNumber,
        model: `${updatedLog.vehicle.brand} ${updatedLog.vehicle.model}`,
        owner: updatedLog.vehicle.user
          ? `${updatedLog.vehicle.user.firstName} ${updatedLog.vehicle.user.lastName}`
          : "Gate Visitor",
        exitTime: formatHistoryDate(now),
        duration,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 6. GET /api/guard/vehicles
 * Returns registered vehicles for GateRegistered.tsx
 */
guardRoutes.get("/vehicles", async (req, res, next) => {
  try {
    const search = ((req.query.search as string) || "").trim();
    const status = (req.query.status as string) || "Active"; // "Active" | "Deactivated"
    const vehicleType = (req.query.vehicleType as string) || "All Vehicles";

    const where: any = {
      registrationSource: "Gate",
    };

    if (status === "Active") {
      where.status = "Approved";
    } else {
      where.status = { not: "Approved" };
    }

    if (vehicleType && vehicleType !== "All Vehicles") {
      where.type = vehicleType;
    }

    if (search) {
      where.OR = [
        { plateNumber: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        { brand: { contains: search, mode: "insensitive" } },
        { rejectionReason: { contains: search, mode: "insensitive" } },
      ];
    }

    const gateVehicles = await db.vehicle.findMany({
      where,
      select: {
        id: true,
        brand: true,
        model: true,
        plateNumber: true,
        type: true,
        ownerName: true,
        idType: true,
        idNumber: true,
        rejectionReason: true,
        registrationSource: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            schoolId: true,
          },
        },
        parkingLogs: {
          take: 1,
          orderBy: { entryTime: "desc" },
          select: {
            id: true,
            entryTime: true,
            exitTime: true,
            duration: true,
            guardName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100, // Index-friendly bound
    });

    const mapped = gateVehicles.map((v) => {
      const latestLog = v.parkingLogs[0];
      let owner = v.ownerName || "Gate Visitor";
      let idNumber = v.idNumber || "N/A";
      let idType = v.idType || "Driver's License / Valid ID";

      if ((!v.ownerName || !v.idNumber) && v.rejectionReason) {
        try {
          const meta = JSON.parse(v.rejectionReason);
          if (!v.ownerName && meta.ownerName && meta.ownerName.trim())
            owner = meta.ownerName.trim();
          if (!v.idNumber && meta.idNumber && meta.idNumber.trim())
            idNumber = meta.idNumber.trim();
          if (!v.idType && meta.idType && meta.idType.trim())
            idType = meta.idType.trim();
        } catch {
          // ignore non-json
        }
      }

      return {
        id: String(v.id),
        owner,
        plate: v.plateNumber,
        vehicleType: (v.type === "Motorcycle" ? "Motorcycle" : "Car") as
          | "Car"
          | "Motorcycle",
        model: `${v.brand} ${v.model}`,
        idType,
        idNumber,
        entryTime: latestLog
          ? formatTimeOnly(new Date(latestLog.entryTime))
          : "--",
        exitTime: latestLog?.exitTime
          ? formatTimeOnly(new Date(latestLog.exitTime))
          : undefined,
        duration: latestLog?.duration || undefined,
        guard: latestLog?.guardName || "Guard Santos",
        registrationDate: formatHistoryDate(new Date(v.createdAt)),
        status: (v.status === "Approved" ? "Active" : "Deactivated") as
          | "Active"
          | "Deactivated",
      };
    });

    return res.status(200).json({
      success: true,
      vehicles: mapped,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 7. POST /api/guard/register-vehicle
 * Registers a temporary visitor or unassigned vehicle at the gate AND immediately records CAMPUS ENTRY
 */
guardRoutes.post("/register-vehicle", async (req, res, next) => {
  try {
    const {
      ownerName,
      vehicleType,
      plateNumber,
      brand,
      model,
      color,
      idType,
      idNumber,
    } = req.body;

    if (!ownerName || !vehicleType || !plateNumber || !model) {
      return res.status(400).json({
        success: false,
        message:
          "Owner name, vehicle type, plate number, and model are required.",
      });
    }

    const normalizedPlate = plateNumber.trim().toUpperCase();

    // Check parking capacity before allowing gate registration + entry
    const [setting, currentlyInside] = await Promise.all([
      db.parkingSetting.findFirst(),
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
        },
      }),
    ]);

    const totalCapacity = setting
      ? setting.carCapacity + setting.motorcycleCapacity
      : 100;
    if (currentlyInside >= totalCapacity) {
      return res.status(400).json({
        success: false,
        message:
          "Parking facility is at full capacity. Entry cannot be recorded at this time.",
      });
    }

    // Resolve Guard Name from req.user
    let guardName = "Security Guard";
    if (req.user?.id) {
      const guardUser = await db.user.findUnique({
        where: { id: req.user.id },
      });
      if (guardUser) {
        guardName =
          `${guardUser.firstName} ${guardUser.lastName}`.trim() ||
          guardUser.email;
      }
    }

    const existingVehicle = await db.vehicle.findUnique({
      where: { plateNumber: normalizedPlate },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    let targetVehicle: any = existingVehicle;

    if (existingVehicle) {
      // 1. BLOCK if vehicle is already officially registered online in SmartPark with an active/approved account!
      const isSmartParkOnlineVehicle =
        existingVehicle.registrationSource === "Online" ||
        (existingVehicle.userId !== null &&
          existingVehicle.status === "Approved") ||
        (existingVehicle.qrCode &&
          existingVehicle.status === "Approved" &&
          existingVehicle.registrationSource !== "Gate");

      if (isSmartParkOnlineVehicle) {
        return res.status(400).json({
          success: false,
          reason: "ALREADY_REGISTERED_SMARTPARK",
          message: `Ang sasakyang ito (${normalizedPlate}) ay rehistrado na sa SmartPark at may opisyal na QR Code pass! Mangyaring gamitin ang Scan QR sa halip na Gate Registration upang ma-utilize ang SmartPark app.`,
        });
      }

      // 2. Check if vehicle is already currently inside campus
      const activeLog = await db.parkingLog.findFirst({
        where: { vehicleId: existingVehicle.id, exitTime: null },
      });

      if (activeLog) {
        return res.status(400).json({
          success: false,
          message: `Vehicle ${normalizedPlate} is already recorded as inside the campus.`,
        });
      }

      // If returning gate visitor / re-registering, reactivate and update details
      targetVehicle = await db.vehicle.update({
        where: { id: existingVehicle.id },
        data: {
          userId: null, // Keep detached from guard account
          type: vehicleType.trim(),
          brand: brand ? brand.trim() : model.split(" ")[0] || "Vehicle",
          model: model.trim(),
          color: color ? color.trim() : "Standard",
          status: "Approved",
          approvedAt: new Date(),
          registrationSource: "Gate",
          ownerName: ownerName.trim(),
          idType: idType ? idType.trim() : "Driver's License",
          idNumber: idNumber ? idNumber.trim() : "N/A",
          rejectionReason: JSON.stringify({
            ownerName: ownerName.trim(),
            idType: idType ? idType.trim() : "Driver's License",
            idNumber: idNumber ? idNumber.trim() : "N/A",
          }),
        },
      });
    } else {
      const qrCode = `SP-${normalizedPlate.replace(/[^A-Z0-9]/g, "")}-${Date.now()}`;

      targetVehicle = await db.vehicle.create({
        data: {
          userId: null, // Gate visitors do not have a user account yet (never assign Guard's id)
          type: vehicleType.trim(),
          plateNumber: normalizedPlate,
          brand: brand ? brand.trim() : model.split(" ")[0] || "Vehicle",
          model: model.trim(),
          color: color ? color.trim() : "Standard",
          year: "2026",
          status: "Approved",
          approvedAt: new Date(),
          qrCode,
          registrationSource: "Gate",
          ownerName: ownerName.trim(),
          idType: idType ? idType.trim() : "Driver's License",
          idNumber: idNumber ? idNumber.trim() : "N/A",
          rejectionReason: JSON.stringify({
            ownerName: ownerName.trim(),
            idType: idType ? idType.trim() : "Driver's License",
            idNumber: idNumber ? idNumber.trim() : "N/A",
          }),
        },
      });
    }

    // Automatically record initial ENTRY log for this gate registration
    const entryLog = await db.parkingLog.create({
      data: {
        vehicleId: targetVehicle.id,
        entryTime: new Date(),
        status: "Currently Parked",
        guardName,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Gate registration and campus entry recorded successfully.",
      vehicle: targetVehicle,
      entryLog: {
        id: entryLog.id,
        entryTime: formatHistoryDate(entryLog.entryTime),
        guardName,
      },
    });
  } catch (err: any) {
    console.error("[GATE REGISTRATION ERROR]:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to register vehicle at gate.",
    });
  }
});

/**
 * 8. PATCH /api/guard/vehicles/:id/deactivate
 * Acts as EXIT & DEACTIVATE: Logs vehicle exit time/duration and marks pass as Inactive
 */
guardRoutes.patch("/vehicles/:id/deactivate", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid vehicle ID." });
    }

    const vehicle = await db.vehicle.findUnique({ where: { id } });
    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle not found." });
    }

    // Find any active parking session for this vehicle
    const activeLog = await db.parkingLog.findFirst({
      where: { vehicleId: id, exitTime: null },
      orderBy: { entryTime: "desc" },
    });

    const now = new Date();
    let durationText = "Just now";

    if (activeLog) {
      durationText = formatDuration(new Date(activeLog.entryTime), now);
      await db.parkingLog.update({
        where: { id: activeLog.id },
        data: {
          exitTime: now,
          duration: durationText,
          status: "Completed",
        },
      });
    }

    const updated = await db.vehicle.update({
      where: { id },
      data: {
        status: "Inactive",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Vehicle exit recorded and pass deactivated successfully.",
      vehicle: updated,
      exitDetails: {
        exitTime: formatHistoryDate(now),
        duration: durationText,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 9. PATCH /api/guard/vehicles/:id/activate
 * Reactivate a deactivated vehicle pass from the gate
 */
guardRoutes.patch("/vehicles/:id/activate", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid vehicle ID." });
    }

    const vehicle = await db.vehicle.findUnique({ where: { id } });
    if (!vehicle) {
      return res
        .status(404)
        .json({ success: false, message: "Vehicle not found." });
    }

    const updated = await db.vehicle.update({
      where: { id },
      data: {
        status: "Approved",
        approvedAt: new Date(),
      },
    });

    // If vehicle does not have an active entry, record an entry log
    const activeLog = await db.parkingLog.findFirst({
      where: { vehicleId: id, exitTime: null },
    });

    if (!activeLog) {
      let guardName = "Security Guard";
      if (req.user?.id) {
        const guardUser = await db.user.findUnique({
          where: { id: req.user.id },
        });
        if (guardUser) {
          guardName =
            `${guardUser.firstName} ${guardUser.lastName}`.trim() ||
            guardUser.email;
        }
      }
      await db.parkingLog.create({
        data: {
          vehicleId: id,
          entryTime: new Date(),
          status: "Currently Parked",
          guardName,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vehicle pass reactivated and entry recorded successfully.",
      vehicle: updated,
    });
  } catch (err) {
    next(err);
  }
});
