import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export const adminAccessRoutes = Router();

adminAccessRoutes.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "GUARD"));

/**
 * Helper to format date & time nicely (e.g. "Nov 17, 7:42 AM")
 */
function formatDateTime(date: Date | null): string {
  if (!date) return "--";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * 1. GET /api/admin/access/records
 * Returns real-time metrics and filtered records for Access & Records overview
 */
adminAccessRoutes.get("/records", async (req, res, next) => {
  try {
    const search = (req.query.search as string)?.trim().toLowerCase() || "";
    const tab = (req.query.tab as string)?.trim() || "Entries"; // "Entries" | "Exits" | "Currently Inside"
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const skip = (page - 1) * limit;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Calculate real-time metrics for today
    const [todayEntries, todayExits, currentlyInside] = await Promise.all([
      db.parkingLog.count({
        where: {
          entryTime: { gte: startOfToday },
        },
      }),
      db.parkingLog.count({
        where: {
          exitTime: { gte: startOfToday },
        },
      }),
      db.parkingLog.count({
        where: {
          OR: [
            { status: "Currently Parked" },
            { exitTime: null },
          ],
        },
      }),
    ]);

    // Build Prisma query condition based on active tab
    const whereCondition: any = {};

    if (tab === "Exits") {
      whereCondition.exitTime = { not: null };
    } else if (tab === "Currently Inside") {
      whereCondition.OR = [
        { status: "Currently Parked" },
        { exitTime: null },
      ];
    }
    // "Entries" shows all parking logs ordered by entryTime

    // Fetch matching logs with vehicle and owner relations
    const [totalMatching, rawLogs] = await Promise.all([
      db.parkingLog.count({ where: whereCondition }),
      db.parkingLog.findMany({
        where: whereCondition,
        include: {
          vehicle: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                  schoolId: true,
                },
              },
            },
          },
        },
        orderBy: tab === "Exits" ? { exitTime: "desc" } : { entryTime: "desc" },
      }),
    ]);

    // Map logs to frontend table format
    const mappedRecords = rawLogs.map((log) => {
      const ownerName = log.vehicle?.user
        ? `${log.vehicle.user.firstName} ${log.vehicle.user.lastName}`
        : "Visitor / Driver";
      const vehicleDesc = log.vehicle
        ? `${log.vehicle.brand} ${log.vehicle.model}`
        : "Vehicle";
      const plateNo = log.vehicle?.plateNumber || "N/A";
      const guard = log.guardName || "Guard Santos";
      const type = log.vehicle?.type || "Car";

      const targetTime = tab === "Exits" ? log.exitTime : log.entryTime;

      return {
        id: log.id,
        plateNo,
        vehicleDesc,
        owner: ownerName,
        dateTime: formatDateTime(targetTime),
        rawTime: targetTime,
        guard,
        type,
        category: tab,
        status: log.status,
      };
    });

    // Apply search filter if query provided
    const filteredRecords = search
      ? mappedRecords.filter(
          (r) =>
            r.plateNo.toLowerCase().includes(search) ||
            r.owner.toLowerCase().includes(search) ||
            r.vehicleDesc.toLowerCase().includes(search) ||
            r.guard.toLowerCase().includes(search)
        )
      : mappedRecords;

    const total = filteredRecords.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginatedRecords = filteredRecords.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      metrics: {
        todayEntries,
        todayExits,
        currentlyInside,
      },
      records: paginatedRecords,
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
 * 2. GET /api/admin/access/history
 * Returns full historical access events (Entry and Exit events) with comprehensive filtering
 */
adminAccessRoutes.get("/history", async (req, res, next) => {
  try {
    const search = (req.query.search as string)?.trim().toLowerCase() || "";
    const actionFilter = (req.query.action as string)?.trim() || "All actions"; // "All actions" | "Entry" | "Exit"
    const sourceFilter = (req.query.source as string)?.trim() || "All sources"; // "All sources" | "User registration" | "Gate registration"
    const dateRange = (req.query.dateRange as string)?.trim() || "All"; // "All" | "Today" | "Yesterday" | "Last 7 days" | string
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const skip = (page - 1) * limit;

    const allLogs = await db.parkingLog.findMany({
      include: {
        vehicle: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { entryTime: "desc" },
    });

    // Deconstruct each parking log into discrete Entry and Exit events
    const events: Array<{
      id: string;
      logId: number;
      plateNo: string;
      vehicleDesc: string;
      owner: string;
      action: "Entry" | "Exit";
      dateTime: string;
      rawDate: Date;
      guard: string;
      source: "User registration" | "Gate registration";
    }> = [];

    allLogs.forEach((log) => {
      const ownerName = log.vehicle?.user
        ? `${log.vehicle.user.firstName} ${log.vehicle.user.lastName}`
        : "Visitor / Driver";
      const vehicleDesc = log.vehicle ? `${log.vehicle.brand} ${log.vehicle.model}` : "Vehicle";
      const plateNo = log.vehicle?.plateNumber || "N/A";
      const guard = log.guardName || "Guard Santos";
      const source: "User registration" | "Gate registration" =
        log.vehicle?.registrationSource?.toLowerCase() === "gate"
          ? "Gate registration"
          : "User registration";

      // 1. Entry Event
      if (log.entryTime) {
        events.push({
          id: `${log.id}-entry`,
          logId: log.id,
          plateNo,
          vehicleDesc,
          owner: ownerName,
          action: "Entry",
          dateTime: formatDateTime(log.entryTime),
          rawDate: new Date(log.entryTime),
          guard,
          source,
        });
      }

      // 2. Exit Event (if vehicle has already exited)
      if (log.exitTime) {
        events.push({
          id: `${log.id}-exit`,
          logId: log.id,
          plateNo,
          vehicleDesc,
          owner: ownerName,
          action: "Exit",
          dateTime: formatDateTime(log.exitTime),
          rawDate: new Date(log.exitTime),
          guard,
          source,
        });
      }
    });

    // Sort all events chronologically (most recent first)
    events.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());

    // Compute unique date labels for dropdown
    const availableDatesSet = new Set<string>();
    events.forEach((ev) => {
      const dateLabel = ev.rawDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      availableDatesSet.add(dateLabel);
    });
    const availableDates = ["All Dates", "Today", "Yesterday", "Last 7 days", ...Array.from(availableDatesSet)];

    // Date range filtering helper
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const filteredEvents = events.filter((ev) => {
      // Action filter
      if (actionFilter !== "All actions" && ev.action !== actionFilter) {
        return false;
      }

      // Source filter
      if (sourceFilter !== "All sources" && ev.source !== sourceFilter) {
        return false;
      }

      // Date range filter
      if (dateRange === "Today") {
        if (ev.rawDate < startOfToday) return false;
      } else if (dateRange === "Yesterday") {
        if (ev.rawDate < startOfYesterday || ev.rawDate >= startOfToday) return false;
      } else if (dateRange === "Last 7 days") {
        if (ev.rawDate < sevenDaysAgo) return false;
      } else if (dateRange !== "All" && dateRange !== "All Dates") {
        const evDateLabel = ev.rawDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        if (evDateLabel !== dateRange && !ev.dateTime.includes(dateRange)) {
          return false;
        }
      }

      // Search filter
      if (search) {
        const matches =
          ev.plateNo.toLowerCase().includes(search) ||
          ev.owner.toLowerCase().includes(search) ||
          ev.guard.toLowerCase().includes(search) ||
          ev.vehicleDesc.toLowerCase().includes(search);
        if (!matches) return false;
      }

      return true;
    });

    const total = filteredEvents.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginatedHistory = filteredEvents.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      history: paginatedHistory,
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
