import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import {
  guardScanRateLimiter,
  guardGeneralRateLimiter,
  guardExportRateLimiter,
  checkIdempotency,
  setIdempotency,
} from "../middlewares/rateLimiter.js";
import {
  scanCodeSchema,
  recordEntrySchema,
  recordExitSchema,
  registerGateVehicleSchema,
  monitoringQuerySchema,
  guardVehiclesQuerySchema,
  vehicleParamSchema,
} from "../validations/guardValidation.js";
import { getGateVehiclesOptimized } from "../utils/queryOptimization.js";

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

function extractOwnerName(vehicle: any): string {
  if (vehicle?.ownerName && vehicle.ownerName.trim()) {
    return vehicle.ownerName.trim();
  }
  if (vehicle?.user) {
    const fullName =
      `${vehicle.user.firstName || ""} ${vehicle.user.lastName || ""}`.trim();
    if (fullName) return fullName;
  }
  if (vehicle?.rejectionReason) {
    try {
      const meta = JSON.parse(vehicle.rejectionReason);
      if (meta?.ownerName && meta.ownerName.trim()) {
        return meta.ownerName.trim();
      }
    } catch {}
  }
  return "Gate Visitor";
}

function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Builds database-level Prisma WHERE conditions for ParkingLog queries
 */
function buildMonitoringWhere(
  tab: string,
  search?: string,
  vehicleType?: string,
  date?: string,
) {
  const where: any = {};

  // 1. Tab status conditions
  if (tab === "exits") {
    where.exitTime = { not: null };
  } else if (tab === "inside") {
    where.OR = [{ status: "Currently Parked" }, { exitTime: null }];
  }
  // Note: "entries" does not need `entryTime: { not: null }` because entryTime is required in Prisma schema

  // 2. Date filtering at the database level
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    // If we have an existing OR condition (from tab === "inside"), wrap it properly
    if (where.OR && tab === "inside") {
      where.AND = [
        { OR: where.OR },
        {
          OR: [
            { exitTime: { gte: startOfDay, lte: endOfDay } },
            { entryTime: { gte: startOfDay, lte: endOfDay } },
          ],
        },
      ];
      delete where.OR;
    } else if (tab === "exits") {
      where.exitTime = { gte: startOfDay, lte: endOfDay };
    } else {
      where.entryTime = { gte: startOfDay, lte: endOfDay };
    }
  }

  // 3. Vehicle type filter
  if (
    vehicleType &&
    vehicleType !== "All Vehicle" &&
    vehicleType !== "All Vehicles"
  ) {
    where.vehicle = {
      ...(where.vehicle || {}),
      type: vehicleType,
    };
  }

  // 4. Search query at the database level (case-insensitive across relevant fields)
  if (search && search.trim()) {
    const s = search.trim();
    const searchConditions = [
      { guardName: { contains: s, mode: "insensitive" } },
      { vehicle: { plateNumber: { contains: s, mode: "insensitive" } } },
      { vehicle: { ownerName: { contains: s, mode: "insensitive" } } },
      { vehicle: { model: { contains: s, mode: "insensitive" } } },
      { vehicle: { brand: { contains: s, mode: "insensitive" } } },
      {
        vehicle: {
          user: {
            isNot: null,
            is: { firstName: { contains: s, mode: "insensitive" } },
          },
        },
      },
      {
        vehicle: {
          user: {
            isNot: null,
            is: { lastName: { contains: s, mode: "insensitive" } },
          },
        },
      },
      {
        vehicle: {
          user: {
            isNot: null,
            is: { schoolId: { contains: s, mode: "insensitive" } },
          },
        },
      },
      { vehicle: { rejectionReason: { contains: s, mode: "insensitive" } } },
    ];

    if (where.AND) {
      where.AND.push({ OR: searchConditions });
    } else if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: searchConditions }];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
  }

  return where;
}

/**
 * 1. GET /api/guard/monitoring
 * Returns live records for Recent Entries, Recent Exits, Currently Inside, and Access History
 */
guardRoutes.get(
  "/monitoring",
  guardGeneralRateLimiter,
  async (req, res, next) => {
    try {
      const validation = monitoringQuerySchema.safeParse(req.query);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message:
            validation.error.issues[0]?.message || "Invalid query parameters.",
        });
      }

      const { tab, search, vehicleType, date, page, limit, cursor } =
        validation.data;

      // Build WHERE conditions using helper
      const where = buildMonitoringWhere(tab, search, vehicleType, date);

      // 1. Get metrics using simple Prisma queries instead of raw SQL
      const [todayEntriesCount, todayExitsCount, currentlyInsideCount, total] =
        await Promise.all([
          db.parkingLog.count({
            where: {
              entryTime: {
                gte: new Date(new Date().toDateString()),
              },
            },
          }),
          db.parkingLog.count({
            where: {
              exitTime: {
                gte: new Date(new Date().toDateString()),
              },
            },
          }),
          db.parkingLog.count({
            where: {
              OR: [{ status: "Currently Parked" }, { exitTime: null }],
            },
          }),
          db.parkingLog.count({ where }),
        ]);

      const totalPages = Math.ceil(total / limit) || 1;

      // 3. Database-level pagination (supports both Cursor and Offset)
      const paginationArgs = {
        where,
        take: limit,
        orderBy: { entryTime: "desc" as const },
        include: {
          vehicle: {
            include: {
              user: {
                select: { firstName: true, lastName: true, schoolId: true },
              },
            },
          },
        },
      } as const;

      const queryArgs = cursor
        ? { ...paginationArgs, skip: 1, cursor: { id: cursor } }
        : { ...paginationArgs, skip: (page - 1) * limit };

      const logs = await db.parkingLog.findMany(queryArgs);

      // 4. Map records according to active tab
      const records = logs.map((log) => {
        const owner = extractOwnerName(log.vehicle);
        const plate = log.vehicle?.plateNumber || "N/A";
        const vType = (
          log.vehicle?.type === "Motorcycle" ? "Motorcycle" : "Car"
        ) as "Car" | "Motorcycle";
        const entryDate = new Date(log.entryTime);
        const exitDate = log.exitTime ? new Date(log.exitTime) : null;

        if (tab === "history") {
          const isExit = !!exitDate;
          const eventDate = isExit ? exitDate : entryDate;
          return {
            id: String(log.id),
            owner,
            plate,
            vehicleType: vType,
            action: isExit ? ("EXIT" as const) : ("ENTRY" as const),
            timeOrDate: formatHistoryDate(eventDate),
            rawDate: eventDate.toISOString().split("T")[0],
            result: "GRANTED" as const,
          };
        }

        if (tab === "exits") {
          return {
            id: String(log.id),
            owner,
            plate,
            vehicleType: vType,
            timeOrDate: exitDate ? formatTimeOnly(exitDate) : "--",
            rawDate: exitDate ? exitDate.toISOString().split("T")[0] : "",
            duration:
              log.duration ||
              (exitDate ? formatDuration(entryDate, exitDate) : "--"),
            guard: log.guardName || "Guard Santos",
          };
        }

        // Default: "entries" or "inside"
        return {
          id: String(log.id),
          owner,
          plate,
          vehicleType: vType,
          timeOrDate: formatTimeOnly(entryDate),
          rawDate: entryDate.toISOString().split("T")[0],
          registrationSource:
            log.vehicle?.registrationSource?.toLowerCase() === "gate"
              ? "Gate registration"
              : "User registration",
          guard: log.guardName || "Guard Santos",
        };
      });

      const nextCursor =
        logs.length === limit && logs.length > 0
          ? (logs[logs.length - 1]?.id ?? null)
          : null;

      return res.status(200).json({
        success: true,
        tab,
        metrics: {
          entriesToday: todayEntriesCount,
          exitsToday: todayExitsCount,
          currentlyInside: currentlyInsideCount,
        },
        records,
        pagination: {
          total,
          page,
          limit,
          totalPages,
          nextCursor,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 1.1 GET /api/guard/export-csv
 * Server-side CSV report export with database-level filtering and UTF-8 BOM
 */
guardRoutes.get(
  "/export-csv",
  guardExportRateLimiter,
  async (req, res, next) => {
    try {
      const validation = monitoringQuerySchema.safeParse(req.query);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message:
            validation.error.issues[0]?.message ||
            "Invalid export query parameters.",
        });
      }

      const { tab, search, vehicleType, date } = validation.data;
      const where = buildMonitoringWhere(tab, search, vehicleType, date);

      // Fetch up to 5000 matching records for export
      const logs = await db.parkingLog.findMany({
        where,
        take: 5000,
        orderBy: { entryTime: "desc" },
        include: {
          vehicle: {
            include: {
              user: {
                select: { firstName: true, lastName: true, schoolId: true },
              },
            },
          },
        },
      });

      let headers: string[] = [];
      const rows: string[] = [];

      if (tab === "history") {
        headers = [
          "Log ID",
          "Owner",
          "Plate Number",
          "Vehicle Type",
          "Action",
          "Date & Time",
          "Result",
        ];
        logs.forEach((log) => {
          const owner = extractOwnerName(log.vehicle);
          const plate = log.vehicle?.plateNumber || "N/A";
          const vType = log.vehicle?.type || "Car";
          const entryDate = new Date(log.entryTime);
          const exitDate = log.exitTime ? new Date(log.exitTime) : null;

          rows.push(
            [
              escapeCsvCell(log.id),
              escapeCsvCell(owner),
              escapeCsvCell(plate),
              escapeCsvCell(vType),
              escapeCsvCell("ENTRY"),
              escapeCsvCell(formatHistoryDate(entryDate)),
              escapeCsvCell("GRANTED"),
            ].join(","),
          );

          if (exitDate) {
            rows.push(
              [
                escapeCsvCell(log.id),
                escapeCsvCell(owner),
                escapeCsvCell(plate),
                escapeCsvCell(vType),
                escapeCsvCell("EXIT"),
                escapeCsvCell(formatHistoryDate(exitDate)),
                escapeCsvCell("GRANTED"),
              ].join(","),
            );
          }
        });
      } else if (tab === "exits") {
        headers = [
          "Log ID",
          "Owner",
          "Plate Number",
          "Vehicle Type",
          "Exit Time",
          "Duration",
          "Guard",
        ];
        logs.forEach((log) => {
          const owner = extractOwnerName(log.vehicle);
          const plate = log.vehicle?.plateNumber || "N/A";
          const vType = log.vehicle?.type || "Car";
          const exitDate = log.exitTime ? new Date(log.exitTime) : null;
          const entryDate = new Date(log.entryTime);

          rows.push(
            [
              escapeCsvCell(log.id),
              escapeCsvCell(owner),
              escapeCsvCell(plate),
              escapeCsvCell(vType),
              escapeCsvCell(exitDate ? formatHistoryDate(exitDate) : "--"),
              escapeCsvCell(
                log.duration ||
                  (exitDate ? formatDuration(entryDate, exitDate) : "--"),
              ),
              escapeCsvCell(log.guardName || "Guard Santos"),
            ].join(","),
          );
        });
      } else if (tab === "inside") {
        headers = [
          "Log ID",
          "Owner",
          "Plate Number",
          "Vehicle Type",
          "Entry Time",
          "Duration Inside",
          "Guard",
        ];
        logs.forEach((log) => {
          const owner = extractOwnerName(log.vehicle);
          const plate = log.vehicle?.plateNumber || "N/A";
          const vType = log.vehicle?.type || "Car";
          const entryDate = new Date(log.entryTime);

          rows.push(
            [
              escapeCsvCell(log.id),
              escapeCsvCell(owner),
              escapeCsvCell(plate),
              escapeCsvCell(vType),
              escapeCsvCell(formatHistoryDate(entryDate)),
              escapeCsvCell(formatDuration(entryDate, new Date())),
              escapeCsvCell(log.guardName || "Guard Santos"),
            ].join(","),
          );
        });
      } else {
        headers = [
          "Log ID",
          "Owner",
          "Plate Number",
          "Vehicle Type",
          "Entry Time",
          "Registration Source",
          "Guard",
        ];
        logs.forEach((log) => {
          const owner = extractOwnerName(log.vehicle);
          const plate = log.vehicle?.plateNumber || "N/A";
          const vType = log.vehicle?.type || "Car";
          const entryDate = new Date(log.entryTime);
          const regSource =
            log.vehicle?.registrationSource?.toLowerCase() === "gate"
              ? "Gate registration"
              : "User registration";

          rows.push(
            [
              escapeCsvCell(log.id),
              escapeCsvCell(owner),
              escapeCsvCell(plate),
              escapeCsvCell(vType),
              escapeCsvCell(formatHistoryDate(entryDate)),
              escapeCsvCell(regSource),
              escapeCsvCell(log.guardName || "Guard Santos"),
            ].join(","),
          );
        });
      }

      // Prepend UTF-8 BOM (\uFEFF) for native Excel compatibility
      const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
      const filename = `GateMonitoring_${tab}_${new Date().toISOString().slice(0, 10)}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      return res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 2. GET /api/guard/dashboard
 * Aggregated live metrics and recent activity for the Guard Dashboard
 */
guardRoutes.get(
  "/dashboard",
  guardGeneralRateLimiter,
  async (req, res, next) => {
    try {
      const now = new Date();
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );

      // Combined live metrics for today using efficient aggregated queries
      const [parkingStats, unreadNotifications, setting] = await Promise.all([
        db.$queryRaw<
          Array<{
            today_entries: bigint;
            today_exits: bigint;
            currently_inside: bigint;
          }>
        >`
        SELECT
          COUNT(*) FILTER (WHERE "entryTime" >= ${startOfToday}) AS today_entries,
          COUNT(*) FILTER (WHERE "exitTime" >= ${startOfToday}) AS today_exits,
          COUNT(*) FILTER (WHERE status = 'Currently Parked' OR "exitTime" IS NULL) AS currently_inside
        FROM parking_log
      `,
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
              {
                title: { contains: "New Incident Report", mode: "insensitive" },
              },
              {
                title: {
                  contains: "New Suspension Appeal",
                  mode: "insensitive",
                },
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

      const stats = parkingStats[0] || {
        today_entries: 0n,
        today_exits: 0n,
        currently_inside: 0n,
      };
      const todayEntries = Number(stats.today_entries);
      const todayExits = Number(stats.today_exits);
      const currentlyInside = Number(stats.currently_inside);

      const totalCapacity = setting
        ? setting.carCapacity + setting.motorcycleCapacity
        : 96;

      // Latest 10 activities (both entries and exits) - Select only required fields
      const logs = await db.parkingLog.findMany({
        take: 10,
        select: {
          id: true,
          entryTime: true,
          exitTime: true,
          vehicle: {
            select: {
              plateNumber: true,
              type: true,
            },
          },
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
  },
);

/**
 * 3. POST /api/guard/scan
 * Validates a vehicle by plate number or QR code for entry / exit
 */
guardRoutes.post("/scan", guardScanRateLimiter, async (req, res, next) => {
  try {
    const validation = scanCodeSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message:
          validation.error.issues[0]?.message ||
          "Plate number or QR code is required",
      });
    }

    const { code } = validation.data;
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
guardRoutes.post(
  "/record-entry",
  guardScanRateLimiter,
  async (req, res, next) => {
    try {
      const validation = recordEntrySchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message:
            validation.error.issues[0]?.message ||
            "Valid Vehicle ID is required.",
        });
      }

      const { vehicleId: numericVehicleId } = validation.data;

      // 1. AUTHORIZATION CHECK: Only GUARD role can record entries
      // Allow guards to perform this action (case-insensitive check)
      const isGuard =
        req.user?.role && ["GUARD", "Guard", "guard"].includes(req.user.role);
      if (!isGuard) {
        return res.status(403).json({
          success: false,
          message:
            "Only Security Guards can record vehicle entries via QR scan.",
        });
      }

      // 2. Idempotency Key Validation
      const idempotencyKey = (req.headers["idempotency-key"] ||
        req.headers["x-idempotency-key"]) as string | undefined;
      if (idempotencyKey) {
        const cached = checkIdempotency(idempotencyKey);
        if (cached?.found) {
          // Return cached response for idempotent retry
          return res.status(200).json(cached.response);
        }
      }

      // 3. Wrap verification, capacity check, and entry recording in an atomic Prisma transaction
      // Use serializable isolation level to prevent concurrent race conditions
      const log = await db.$transaction(
        async (tx) => {
          // Lock the vehicle row for update to prevent concurrent modifications
          const targetVehicle = await tx.vehicle.findUnique({
            where: { id: numericVehicleId },
            include: {
              user: {
                select: {
                  id: true,
                  accountStatus: true,
                  role: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          });

          if (!targetVehicle) {
            throw new Error("VEHICLE_NOT_FOUND");
          }

          // Vehicle status must be "Approved" for entry
          if (targetVehicle.status !== "Approved") {
            throw new Error(`INVALID_STATUS:${targetVehicle.status}`);
          }

          // For online-registered vehicles (with owner), check owner account status
          if (
            targetVehicle.user &&
            targetVehicle.user.accountStatus !== "Active"
          ) {
            throw new Error(
              `OWNER_INACTIVE:${targetVehicle.user.accountStatus}`,
            );
          }

          // For gate-registered vehicles, check registration age (max 24 hours)
          if (targetVehicle.registrationSource === "Gate") {
            const registrationAge =
              Date.now() - new Date(targetVehicle.createdAt).getTime();
            const MAX_GATE_REGISTRATION_AGE = 24 * 60 * 60 * 1000; // 24 hours

            if (registrationAge > MAX_GATE_REGISTRATION_AGE) {
              throw new Error("GATE_REGISTRATION_EXPIRED");
            }
          }

          // Critical section: Check for active log under transaction lock
          // This prevents another concurrent request from creating duplicate entries
          const activeLog = await tx.parkingLog.findFirst({
            where: { vehicleId: numericVehicleId, exitTime: null },
          });

          if (activeLog) {
            throw new Error("ALREADY_INSIDE");
          }

          const [setting, currentlyInside] = await Promise.all([
            tx.parkingSetting.findFirst(),
            tx.parkingLog.count({
              where: {
                OR: [{ status: "Currently Parked" }, { exitTime: null }],
              },
            }),
          ]);

          const totalCapacity = setting
            ? setting.carCapacity + setting.motorcycleCapacity
            : 100;
          if (currentlyInside >= totalCapacity) {
            throw new Error("PARKING_FULL");
          }

          let guardName = "Security Guard";
          if (req.user?.id) {
            const guardUser = await tx.user.findUnique({
              where: { id: req.user.id },
            });
            if (guardUser) {
              guardName =
                `${guardUser.firstName} ${guardUser.lastName}`.trim() ||
                guardUser.email;
            }
          }

          return tx.parkingLog.create({
            data: {
              vehicleId: numericVehicleId,
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
        },
        {
          // Use serializable isolation to prevent phantom reads and ensure true ACID compliance
          isolationLevel: "Serializable",
          timeout: 30000, // 30 second timeout for transaction
        },
      );

      const responsePayload = {
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
      };

      if (idempotencyKey) {
        setIdempotency(idempotencyKey, responsePayload);
      }

      return res.status(201).json(responsePayload);
    } catch (err: any) {
      if (err.message === "VEHICLE_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found. Access denied.",
        });
      }
      if (err.message?.startsWith("INVALID_STATUS:")) {
        const st = err.message.split(":")[1];
        return res.status(403).json({
          success: false,
          message: `Vehicle status is '${st}'. Only approved vehicles are authorized for entry.`,
        });
      }
      if (err.message?.startsWith("OWNER_INACTIVE:")) {
        const st = err.message.split(":")[1];
        return res.status(403).json({
          success: false,
          message: `Vehicle owner account is ${st}. Entry is unauthorized.`,
        });
      }
      if (err.message === "GATE_REGISTRATION_EXPIRED") {
        return res.status(403).json({
          success: false,
          message:
            "Gate registration has expired (older than 24 hours). Vehicle must be re-registered for entry.",
        });
      }
      if (err.message === "ALREADY_INSIDE") {
        return res.status(400).json({
          success: false,
          message: "Vehicle is already recorded as inside campus.",
        });
      }
      if (err.message === "PARKING_FULL") {
        return res.status(400).json({
          success: false,
          message: "Parking lot is at full capacity. Entry denied.",
        });
      }
      if (err.code === "P2002") {
        return res.status(409).json({
          success: false,
          message:
            "Duplicate entry detected. Entry already recorded for this vehicle at this timestamp.",
        });
      }
      if (err.code === "P1016" || err.message?.includes("serialization")) {
        return res.status(503).json({
          success: false,
          message: "System temporarily busy. Please retry your request.",
        });
      }
      next(err);
    }
  },
);

/**
 * 5. POST /api/guard/record-exit
 * Records an exit into the parkingLog table and computes duration
 * Uses Serializable isolation and idempotency keys to prevent concurrent exit duplicates
 * GUARD-ONLY operation
 */
guardRoutes.post(
  "/record-exit",
  guardScanRateLimiter,
  async (req, res, next) => {
    try {
      const validation = recordExitSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message:
            validation.error.issues[0]?.message ||
            "Valid Vehicle ID is required.",
        });
      }

      const { vehicleId: numericVehicleId } = validation.data;

      // 1. AUTHORIZATION CHECK: Only GUARD role can record exits
      // Allow guards to perform this action (case-insensitive check)
      const isGuard =
        req.user?.role && ["GUARD", "Guard", "guard"].includes(req.user.role);
      if (!isGuard) {
        return res.status(403).json({
          success: false,
          message: "Only Security Guards can record vehicle exits via QR scan.",
        });
      }

      // 2. Idempotency Key Validation
      const idempotencyKey = (req.headers["idempotency-key"] ||
        req.headers["x-idempotency-key"]) as string | undefined;
      if (idempotencyKey) {
        const cached = checkIdempotency(idempotencyKey);
        if (cached?.found) {
          // Return cached response for idempotent retry
          return res.status(200).json(cached.response);
        }
      }

      // 3. Wrap exit record verification and update in an atomic Prisma transaction
      // Use serializable isolation level to prevent concurrent race conditions
      const { updatedLog, duration, now } = await db.$transaction(
        async (tx) => {
          const targetVehicle = await tx.vehicle.findUnique({
            where: { id: numericVehicleId },
          });

          if (!targetVehicle) {
            throw new Error("VEHICLE_NOT_FOUND");
          }

          // Critical section: Find active log under transaction lock
          // This prevents concurrent exit attempts from updating the same log twice
          const activeLog = await tx.parkingLog.findFirst({
            where: { vehicleId: numericVehicleId, exitTime: null },
            orderBy: { entryTime: "desc" },
          });

          if (!activeLog) {
            throw new Error("NO_ACTIVE_ENTRY");
          }

          const exitTime = new Date();
          const computedDuration = formatDuration(
            new Date(activeLog.entryTime),
            exitTime,
          );

          let guardName = activeLog.guardName;
          if (req.user?.id) {
            const guardUser = await tx.user.findUnique({
              where: { id: req.user.id },
            });
            if (guardUser) {
              guardName =
                `${guardUser.firstName} ${guardUser.lastName}`.trim() ||
                guardUser.email;
            }
          }

          const updated = await tx.parkingLog.update({
            where: { id: activeLog.id },
            data: {
              exitTime,
              duration: computedDuration,
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

          return {
            updatedLog: updated,
            duration: computedDuration,
            now: exitTime,
          };
        },
        {
          // Use serializable isolation to prevent phantom reads and ensure true ACID compliance
          isolationLevel: "Serializable",
          timeout: 30000, // 30 second timeout for transaction
        },
      );

      const responsePayload = {
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
      };

      if (idempotencyKey) {
        setIdempotency(idempotencyKey, responsePayload);
      }

      return res.status(200).json(responsePayload);
    } catch (err: any) {
      if (err.message === "VEHICLE_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Vehicle not found. Exit processing denied.",
        });
      }
      if (err.message === "NO_ACTIVE_ENTRY") {
        return res.status(400).json({
          success: false,
          message: "No active entry record found for this vehicle.",
        });
      }
      if (err.code === "P1016" || err.message?.includes("serialization")) {
        return res.status(503).json({
          success: false,
          message: "System temporarily busy. Please retry your request.",
        });
      }
      next(err);
    }
  },
);

/**
 * 6. GET /api/guard/vehicles
 * Returns registered vehicles for GateRegistered.tsx with server-side pagination & filtering
 * OPTIMIZED: Uses batch loading to avoid N+1 query problem
 */
guardRoutes.get(
  "/vehicles",
  guardGeneralRateLimiter,
  async (req, res, next) => {
    try {
      const validation = guardVehiclesQuerySchema.safeParse(req.query);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message:
            validation.error.issues[0]?.message || "Invalid query parameters.",
        });
      }

      const { search, status, vehicleType, page, limit, cursor } =
        validation.data;

      // Use optimized batch loading query (2 queries instead of 1+N)
      const result = await getGateVehiclesOptimized({
        search,
        status: status === "Active" ? "Active" : "Deactivated",
        vehicleType,
        page,
        limit,
        cursor,
      });

      // Map vehicles with pre-fetched parking logs
      const mapped = result.vehicles.map((v) => {
        const latestLog = result.parkingLogs[v.id];
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

      const nextCursor =
        result.vehicles.length === limit && result.vehicles.length > 0
          ? (result.vehicles[result.vehicles.length - 1]?.id ?? null)
          : null;

      return res.status(200).json({
        success: true,
        vehicles: mapped,
        pagination: {
          total: result.total,
          page,
          limit,
          totalPages: result.totalPages,
          nextCursor,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 7. POST /api/guard/register-vehicle
 * Registers a temporary visitor or unassigned vehicle at the gate AND immediately records CAMPUS ENTRY
 */
guardRoutes.post(
  "/register-vehicle",
  guardScanRateLimiter,
  async (req, res, next) => {
    try {
      const validation = registerGateVehicleSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message:
            validation.error.issues[0]?.message ||
            "Invalid gate registration input.",
        });
      }

      const {
        ownerName,
        vehicleType,
        plateNumber,
        brand,
        model,
        color,
        idType,
        idNumber,
      } = validation.data;

      const normalizedPlate = plateNumber.trim().toUpperCase();

      // Perform gate registration and entry recording inside an atomic Prisma transaction
      const result = await db.$transaction(async (tx) => {
        // Check parking capacity before allowing gate registration + entry
        const [setting, currentlyInside] = await Promise.all([
          tx.parkingSetting.findFirst(),
          tx.parkingLog.count({
            where: {
              OR: [{ status: "Currently Parked" }, { exitTime: null }],
            },
          }),
        ]);

        const totalCapacity = setting
          ? setting.carCapacity + setting.motorcycleCapacity
          : 100;
        if (currentlyInside >= totalCapacity) {
          throw new Error("PARKING_FULL");
        }

        // Resolve Guard Name from req.user
        let guardName = "Security Guard";
        if (req.user?.id) {
          const guardUser = await tx.user.findUnique({
            where: { id: req.user.id },
          });
          if (guardUser) {
            guardName =
              `${guardUser.firstName} ${guardUser.lastName}`.trim() ||
              guardUser.email;
          }
        }

        const existingVehicle = await tx.vehicle.findUnique({
          where: { plateNumber: normalizedPlate },
          include: {
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        });

        let targetVehicle: any = existingVehicle;

        if (existingVehicle) {
          const isSmartParkOnlineVehicle =
            existingVehicle.registrationSource === "Online" ||
            (existingVehicle.userId !== null &&
              existingVehicle.status === "Approved") ||
            (existingVehicle.qrCode &&
              existingVehicle.status === "Approved" &&
              existingVehicle.registrationSource !== "Gate");

          if (isSmartParkOnlineVehicle) {
            throw new Error("ALREADY_REGISTERED_SMARTPARK");
          }

          const activeLog = await tx.parkingLog.findFirst({
            where: { vehicleId: existingVehicle.id, exitTime: null },
          });

          if (activeLog) {
            throw new Error("ALREADY_INSIDE");
          }

          // PLATE IMMUTABILITY CHECK: Prevent re-registration of same plate with different details
          // If vehicle was registered at gate and still "Approved" (active), reject re-registration
          // This prevents guards from fraudulently changing vehicle details mid-session
          if (
            existingVehicle.registrationSource === "Gate" &&
            existingVehicle.status === "Approved"
          ) {
            const registrationAge =
              Date.now() - new Date(existingVehicle.approvedAt || 0).getTime();
            const ONE_HOUR = 60 * 60 * 1000;

            // If registered less than 1 hour ago, it's still considered "active" registration
            // Cannot re-register same plate within 1 hour to prevent details fraud
            if (registrationAge < ONE_HOUR) {
              throw new Error(
                `PLATE_RECENTLY_REGISTERED:${Math.ceil((ONE_HOUR - registrationAge) / 1000)}`,
              );
            }
          }

          // Check if details match - if same plate but different vehicle type/color, it's suspicious
          // Allow update only if: vehicle exited AND enough time passed, OR details match
          const detailsMismatch =
            existingVehicle.type !== vehicleType.trim() ||
            existingVehicle.color !== (color ? color.trim() : "Standard");

          if (detailsMismatch && existingVehicle.status === "Approved") {
            throw new Error(
              `PLATE_DETAILS_MISMATCH:${existingVehicle.type}|${existingVehicle.color}|${existingVehicle.brand}`,
            );
          }

          targetVehicle = await tx.vehicle.update({
            where: { id: existingVehicle.id },
            data: {
              userId: null,
              type: vehicleType.trim(),
              brand: brand.trim(),
              model: model.trim(),
              color: color.trim(),
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

          targetVehicle = await tx.vehicle.create({
            data: {
              userId: null,
              type: vehicleType.trim(),
              plateNumber: normalizedPlate,
              brand: brand.trim(),
              model: model.trim(),
              color: color.trim(),
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

        const entryLog = await tx.parkingLog.create({
          data: {
            vehicleId: targetVehicle.id,
            entryTime: new Date(),
            status: "Currently Parked",
            guardName,
          },
        });

        return { targetVehicle, entryLog, guardName };
      });

      return res.status(201).json({
        success: true,
        message: "Gate registration and campus entry recorded successfully.",
        vehicle: result.targetVehicle,
        entryLog: {
          id: result.entryLog.id,
          entryTime: formatHistoryDate(result.entryLog.entryTime),
          guardName: result.guardName,
        },
      });
    } catch (err: any) {
      if (err.message === "PARKING_FULL") {
        return res.status(400).json({
          success: false,
          message:
            "Parking facility is at full capacity. Entry cannot be recorded at this time.",
        });
      }
      if (err.message === "ALREADY_REGISTERED_SMARTPARK") {
        return res.status(400).json({
          success: false,
          reason: "ALREADY_REGISTERED_SMARTPARK",
          message:
            "Ang sasakyang ito ay rehistrado na sa SmartPark at may opisyal na QR Code pass! Mangyaring gamitin ang Scan QR sa halip na Gate Registration upang ma-utilize ang SmartPark app.",
        });
      }
      if (err.message === "ALREADY_INSIDE") {
        return res.status(400).json({
          success: false,
          message: "Vehicle is already recorded as inside the campus.",
        });
      }
      if (err.message?.startsWith("PLATE_RECENTLY_REGISTERED:")) {
        const secondsRemaining = err.message.split(":")[1];
        return res.status(409).json({
          success: false,
          reason: "PLATE_RECENTLY_REGISTERED",
          message: `This plate was registered less than 1 hour ago. Cannot re-register the same plate yet. Please wait ${secondsRemaining} seconds or deactivate the previous registration first.`,
          secondsRemaining: parseInt(secondsRemaining),
        });
      }
      if (err.message?.startsWith("PLATE_DETAILS_MISMATCH:")) {
        const details = err.message.split(":")[1].split("|");
        return res.status(409).json({
          success: false,
          reason: "PLATE_DETAILS_MISMATCH",
          message: `This plate is already registered with different vehicle details (${details[2]} ${details[0]}, ${details[1]}). Cannot change vehicle specifications for active registration. Please deactivate the previous entry first.`,
          existingDetails: {
            type: details[0],
            color: details[1],
            brand: details[2],
          },
        });
      }
      next(err);
    }
  },
);

/**
 * 8. PATCH /api/guard/vehicles/:id/deactivate
 * Acts as EXIT & DEACTIVATE: Logs vehicle exit time/duration and marks pass as Inactive
 */
guardRoutes.patch(
  "/vehicles/:id/deactivate",
  guardGeneralRateLimiter,
  async (req, res, next) => {
    try {
      const validation = vehicleParamSchema.safeParse({ id: req.params.id });
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message: validation.error.issues[0]?.message || "Invalid vehicle ID.",
        });
      }

      const { id } = validation.data;

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
  },
);

/**
 * 9. PATCH /api/guard/vehicles/:id/activate
 * Reactivate a deactivated vehicle pass from the gate
 */
guardRoutes.patch(
  "/vehicles/:id/activate",
  guardGeneralRateLimiter,
  async (req, res, next) => {
    try {
      const validation = vehicleParamSchema.safeParse({ id: req.params.id });
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message: validation.error.issues[0]?.message || "Invalid vehicle ID.",
        });
      }

      const { id } = validation.data;

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
  },
);
