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

    // 1. Live Core Metrics
    const [
      currentlyInside,
      todayEntries,
      todayExits,
      lastExitLog,
      pendingIncidentCount,
      latestIncident,
      pendingVehicleCount,
      latestVehicle,
      recentParkingLogs,
    ] = await Promise.all([
      db.parkingLog.count({
        where: {
          OR: [{ status: "Currently Parked" }, { exitTime: null }],
        },
      }),
      db.parkingLog.count({
        where: { entryTime: { gte: startOfToday } },
      }),
      db.parkingLog.count({
        where: { exitTime: { gte: startOfToday } },
      }),
      db.parkingLog.findFirst({
        where: { exitTime: { not: null } },
        orderBy: { exitTime: "desc" },
        select: { exitTime: true },
      }),
      db.incident.count({
        where: { status: "Pending" },
      }),
      db.incident.findFirst({
        where: { status: "Pending" },
        orderBy: { createdAt: "desc" },
      }),
      db.vehicle.count({
        where: { status: "Pending" },
      }),
      db.vehicle.findFirst({
        where: { status: "Pending" },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.parkingLog.findMany({
        where: { entryTime: { gte: past7Days } },
        select: { entryTime: true },
      }),
    ]);

    const availableSpaces = Math.max(0, totalCapacity - currentlyInside);
    const occupancyRate = totalCapacity > 0 ? Math.round((currentlyInside / totalCapacity) * 100) : 0;
    const availabilityStatus = occupancyRate >= 85 ? "Low" : occupancyRate >= 50 ? "Moderate" : "High";

    // Format last exit time
    let lastExitTimeFormatted = "None today";
    if (lastExitLog?.exitTime) {
      lastExitTimeFormatted = `Last Exit: ${lastExitLog.exitTime.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })}`;
    }

    // 2. Weekly Utilization Trend (Mon - Sun counts)
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklyUtilization: { [day: string]: number } = {
      Mon: 0,
      Tue: 0,
      Wed: 0,
      Thu: 0,
      Fri: 0,
      Sat: 0,
      Sun: 0,
    };

    recentParkingLogs.forEach((log) => {
      const dayIdx = new Date(log.entryTime).getDay();
      const dName = dayNames[dayIdx];
      if (dName && typeof weeklyUtilization[dName] === "number") {
        weeklyUtilization[dName] += 1;
      }
    });

    // 3. Compile Live Recent Activity Feed
    const [recentLogsForActivity, recentIncidentsForActivity, recentVehiclesForActivity] = await Promise.all([
      db.parkingLog.findMany({
        take: 4,
        orderBy: { createdAt: "desc" },
        include: { vehicle: true },
      }),
      db.incident.findMany({
        take: 3,
        orderBy: { createdAt: "desc" },
      }),
      db.vehicle.findMany({
        take: 3,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { firstName: true, lastName: true },
          },
        },
      }),
    ]);

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
          totalWeeklyLogs: recentParkingLogs.length,
        },
        awaitingAction: {
          latestIncident: latestIncident
            ? {
                id: latestIncident.id,
                referenceId: latestIncident.referenceId,
                reportType: latestIncident.reportType,
                model: latestIncident.model || "Vehicle",
                plate: latestIncident.plateNumber,
              }
            : null,
          pendingIncidentCount,
          latestVehicle: latestVehicle
            ? {
                id: latestVehicle.id,
                plateNumber: latestVehicle.plateNumber,
                brand: latestVehicle.brand,
                model: latestVehicle.model,
                ownerName: latestVehicle.user
                  ? `${latestVehicle.user.lastName}, ${latestVehicle.user.firstName}`
                  : "Registered User",
              }
            : null,
          pendingVehicleCount,
        },
        recentActivities,
      },
    });
  } catch (err) {
    next(err);
  }
});
