import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export const adminDashboardRoutes = Router();

adminDashboardRoutes.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

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
 * Helper to format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin > 1 ? "s" : ""} ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * GET /api/admin/dashboard
 * Aggregated live metrics, trends, awaiting actions, and recent activities
 */
adminDashboardRoutes.get("/", async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const past7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const setting = await getOrCreateParkingSetting();
    const totalCapacity = setting.carCapacity + setting.motorcycleCapacity;

    // Single batched round-trip: metrics + awaiting items + activity feed + weekly trend
    const [
      currentlyInside,
      todayEntries,
      todayExits,
      lastExitLog,
      pendingIncidentCount,
      pendingIncidents,
      pendingVehicleCount,
      pendingVehicles,
      recentLogsForActivity,
      recentIncidentsForActivity,
      recentVehiclesForActivity,
      weeklyTrendRows,
    ] = await Promise.all([
      // 1. Count currently parked
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
        },
      }),
      // 2. Today entries
      db.parkingLog.count({
        where: { entryTime: { gte: startOfToday } },
      }),
      // 3. Today exits
      db.parkingLog.count({
        where: { exitTime: { gte: startOfToday } },
      }),
      // 4. Last exit log
      db.parkingLog.findFirst({
        where: { exitTime: { not: null } },
        orderBy: { exitTime: "desc" },
        select: { exitTime: true },
      }),
      // 5. Pending incident count
      db.incident.count({
        where: { status: "Pending" },
      }),
      // 6. Top-2 pending incidents (composite index: status, createdAt)
      db.incident.findMany({
        where: { status: "Pending" },
        orderBy: { createdAt: "desc" },
        take: 2,
        select: {
          id: true,
          referenceId: true,
          reportType: true,
          model: true,
          plateNumber: true,
        },
      }),
      // 7. Pending vehicle count
      db.vehicle.count({
        where: { status: "Pending" },
      }),
      // 8. Top-2 pending vehicles (composite index: status, createdAt)
      db.vehicle.findMany({
        where: { status: "Pending" },
        orderBy: { createdAt: "desc" },
        take: 2,
        select: {
          id: true,
          plateNumber: true,
          brand: true,
          model: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      // 9. Recent parking logs for activity feed
      db.parkingLog.findMany({
        take: 4,
        orderBy: { createdAt: "desc" },
        include: { vehicle: true },
      }),
      // 10. Recent incidents for activity feed
      db.incident.findMany({
        take: 3,
        orderBy: { createdAt: "desc" },
      }),
      // 11. Recent vehicle registrations for activity feed
      db.vehicle.findMany({
        take: 3,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          plateNumber: true,
          createdAt: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      // 12. Weekly utilization via DB-side GROUP BY — no JS aggregation of full table rows
      db.$queryRaw<{ dow: number; cnt: bigint }[]>`
        SELECT
          EXTRACT(DOW FROM "entryTime" AT TIME ZONE 'Asia/Manila')::int AS dow,
          COUNT(*)::bigint AS cnt
        FROM "parking_log"
        WHERE "entryTime" >= ${past7Days}
        GROUP BY dow
      `,
    ]);

    // --- Metrics ---
    const availableSpaces = Math.max(0, totalCapacity - currentlyInside);
    const occupancyRate = totalCapacity > 0 ? Math.round((currentlyInside / totalCapacity) * 100) : 0;
    const availabilityStatus = occupancyRate >= 85 ? "Low" : occupancyRate >= 50 ? "Moderate" : "High";

    let lastExitTimeFormatted = "None today";
    if (lastExitLog?.exitTime) {
      lastExitTimeFormatted = `Last Exit: ${lastExitLog.exitTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })}`;
    }

    // --- Weekly Utilization Trend ---
    // EXTRACT(DOW): 0=Sunday, 1=Monday, ..., 6=Saturday
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
    const weeklyUtilization: Record<string, number> = {
      Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0,
    };
    let totalWeeklyLogs = 0;
    for (const row of weeklyTrendRows) {
      const dName = dayNames[row.dow];
      if (dName) {
        const cnt = Number(row.cnt);
        weeklyUtilization[dName] = cnt;
        totalWeeklyLogs += cnt;
      }
    }

    // --- Activity Feed ---
    interface ActivityItem {
      id: string;
      title: string;
      time: string;
      rawDate: Date;
      dotColor: string;
      type: "entry" | "exit" | "incident" | "registration";
    }

    const activities: ActivityItem[] = [];

    // Add entry & exit activities
    recentLogsForActivity.forEach((log) => {
      const plate = log.vehicle?.plateNumber || "Vehicle";
      if (log.exitTime) {
        activities.push({
          id: `exit-${log.id}`,
          title: `Vehicle ${plate} has exited the facility`,
          time: formatRelativeTime(log.exitTime),
          rawDate: new Date(log.exitTime),
          dotColor: "bg-amber-500",
          type: "exit",
        });
      }
      if (log.entryTime) {
        activities.push({
          id: `entry-${log.id}`,
          title: `Vehicle ${plate} has entered`,
          time: formatRelativeTime(log.entryTime),
          rawDate: new Date(log.entryTime),
          dotColor: "bg-emerald-500",
          type: "entry",
        });
      }
    });

    // Add incident activities
    recentIncidentsForActivity.forEach((inc) => {
      activities.push({
        id: `inc-${inc.id}`,
        title: `Incident ${inc.referenceId} reported (${inc.reportType})`,
        time: formatRelativeTime(inc.createdAt),
        rawDate: new Date(inc.createdAt),
        dotColor: inc.status === "Pending" ? "bg-rose-500" : "bg-blue-500",
        type: "incident",
      });
    });

    // Add vehicle registration activities
    recentVehiclesForActivity.forEach((veh) => {
      const owner = veh.user ? `${veh.user.firstName} ${veh.user.lastName}` : "User";
      activities.push({
        id: `veh-${veh.id}`,
        title: `Vehicle ${veh.plateNumber} registration submitted by ${owner}`,
        time: formatRelativeTime(veh.createdAt),
        rawDate: new Date(veh.createdAt),
        dotColor: "bg-blue-600",
        type: "registration",
      });
    });

    // Sort chronologically and take top 5
    activities.sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
    const recentActivities = activities.slice(0, 5).map(({ id, title, time, dotColor, type }) => ({
      id,
      title,
      time,
      dotColor,
      type,
    }));

    // --- Shape awaiting action (top-2 arrays) ---
    const mappedIncidents = pendingIncidents.map((inc) => ({
      id: inc.id,
      referenceId: inc.referenceId,
      reportType: inc.reportType,
      model: inc.model || "Vehicle",
      plate: inc.plateNumber,
    }));

    const mappedVehicles = pendingVehicles.map((veh) => ({
      id: veh.id,
      plateNumber: veh.plateNumber,
      brand: veh.brand,
      model: veh.model,
      ownerName: veh.user
        ? `${veh.user.lastName}, ${veh.user.firstName}`
        : "Registered User",
    }));

    return res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalCapacity,
          availableSpaces,
          currentlyInside,
          occupancyRate,
          availabilityStatus,
          todayEntries,
          todayExits,
          lastExitTimeFormatted,
          pendingIncidentCount,
          pendingVehicleCount,
        },
        trends: {
          weeklyUtilization,
          totalWeeklyLogs,
        },
        awaitingAction: {
          pendingIncidents: mappedIncidents,
          pendingIncidentCount,
          pendingVehicles: mappedVehicles,
          pendingVehicleCount,
        },
        recentActivities,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/dashboard/sidebar-counts
 * Lightweight endpoint to fetch live notification counters for sidebar badges
 */
adminDashboardRoutes.get("/sidebar-counts", async (req, res, next) => {
  try {
    const [pendingVehicles, pendingIncidents, unreadNotifications] = await Promise.all([
      db.vehicle.count({ where: { status: "Pending" } }),
      db.incident.count({ where: { status: "Pending" } }),
      db.notification.count({ where: { read: false } }),
    ]);

    return res.status(200).json({
      success: true,
      counts: {
        pendingVehicles,
        pendingIncidents,
        unreadNotifications,
      },
    });
  } catch (err) {
    next(err);
  }
});
