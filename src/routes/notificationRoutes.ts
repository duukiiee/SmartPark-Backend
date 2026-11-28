import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export const adminNotificationRoutes = Router();

// Allow Guards, Admins, and Super Admins
adminNotificationRoutes.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "GUARD"));

/**
 * Helper to format date & time nicely (e.g. "Nov 17, 7:42 AM")
 */
function formatTime(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

let hasInitialSyncRun = false;

/**
 * Auto-sync helper: seeds notifications only if initial sync has not run yet
 */
async function syncSystemNotifications() {
  if (hasInitialSyncRun) return;
  hasInitialSyncRun = true;
  try {
    const existingCount = await db.notification.count();
    if (existingCount > 0) return; // Database already has notifications, no heavy sync needed!
    // 1. Check pending incidents -> Alerts
    const pendingIncidents = await db.incident.findMany({
      where: { status: "Pending" },
      take: 5,
      orderBy: { createdAt: "desc" },
    });

    for (const inc of pendingIncidents) {
      const existing = await db.notification.findFirst({
        where: {
          title: `New Incident Report: ${inc.referenceId}`,
        },
      });

      if (!existing) {
        await db.notification.create({
          data: {
            title: `New Incident Report: ${inc.referenceId}`,
            description: `${inc.reportType} reported for plate ${inc.plateNumber}. Waiting for security/admin review.`,
            type: "alert",
            link: `/admin/incidents/review/${inc.id}`,
            read: false,
            createdAt: inc.createdAt || new Date(),
          },
        });
      }
    }

    // 2. Check pending vehicle registrations -> Updates
    const pendingVehicles = await db.vehicle.findMany({
      where: { status: "Pending" },
      take: 5,
      orderBy: { createdAt: "desc" },
    });

    for (const veh of pendingVehicles) {
      const existing = await db.notification.findFirst({
        where: {
          title: `Vehicle Registration Pending: ${veh.plateNumber}`,
        },
      });

      if (!existing) {
        await db.notification.create({
          data: {
            title: `Vehicle Registration Pending: ${veh.plateNumber}`,
            description: `${veh.brand} ${veh.model} (${veh.type}) registered by owner. Awaiting document verification and pass approval.`,
            type: "update",
            link: `/admin/vehicles/registration`,
            read: false,
            createdAt: veh.createdAt || new Date(),
          },
        });
      }
    }

    // 3. Check recently approved vehicles -> Updates
    const approvedVehicles = await db.vehicle.findMany({
      where: { status: "Approved" },
      take: 5,
      orderBy: { updatedAt: "desc" },
    });

    for (const veh of approvedVehicles) {
      const title = `Vehicle Pass Approved: ${veh.plateNumber}`;
      const existing = await db.notification.findFirst({
        where: { title },
      });

      if (!existing) {
        await db.notification.create({
          data: {
            title,
            description: `${veh.brand} ${veh.model} (${veh.plateNumber}) pass is approved and active for campus entry.`,
            type: "update",
            link: `/guard/registration`,
            read: false,
            createdAt: veh.approvedAt || veh.updatedAt || new Date(),
          },
        });
      }
    }

    // 4. Check parking lot full capacity -> Warnings
    const parkedCount = await db.parkingLog.count({
      where: {
        OR: [{ status: "Currently Parked" }, { exitTime: null }],
      },
    });

    const setting = await db.parkingSetting.findFirst();
    const totalCapacity = (setting?.carCapacity || 60) + (setting?.motorcycleCapacity || 40);

    if (parkedCount >= totalCapacity) {
      const title = "Parking Lot Is Full";
      const existing = await db.notification.findFirst({
        where: { title, read: false },
      });

      if (!existing) {
        await db.notification.create({
          data: {
            title,
            description: `Facility has reached full capacity (${parkedCount}/${totalCapacity}). Guard entries should be queued.`,
            type: "warning",
            link: `/guard/monitoring`,
            read: false,
            createdAt: new Date(),
          },
        });
      }
    }
  } catch (err) {
    console.error("Error auto-syncing system notifications:", err);
  }
}

/**
 * Role-based notification isolation criteria:
 * Ensures Admin and Guard have 100% separate notification streams.
 */
export function getRoleNotificationCriteria(role: string) {
  if (role === "GUARD") {
    return {
      AND: [
        {
          userId: null, // Guard only receives system broadcast notifications, not individual student alerts
        },
        {
          NOT: [
            { link: { startsWith: "/admin" } },
            { link: { startsWith: "/student" } },
            { title: { contains: "Vehicle Registration Pending", mode: "insensitive" as const } },
            { title: { contains: "New Vehicle Registration", mode: "insensitive" as const } },
            { title: { contains: "New Incident Report", mode: "insensitive" as const } },
            { title: { contains: "New Incident:", mode: "insensitive" as const } },
            { title: { contains: "New Suspension Appeal", mode: "insensitive" as const } },
            { title: { contains: "Gate Vehicle Claimed", mode: "insensitive" as const } },
            { title: { contains: "Report Reviewed", mode: "insensitive" as const } },
            { title: { contains: "Report Disapproved", mode: "insensitive" as const } },
            { description: { contains: "Waiting for security/admin review", mode: "insensitive" as const } },
            { description: { contains: "Awaiting document verification", mode: "insensitive" as const } },
            { description: { contains: "Pending admin approval", mode: "insensitive" as const } },
          ],
        },
        {
          OR: [
            { link: { startsWith: "/guard" } },
            { title: { contains: "Parking", mode: "insensitive" as const } },
            { title: { contains: "Pass Approved", mode: "insensitive" as const } },
            { title: { contains: "Gate", mode: "insensitive" as const } },
            { type: "warning" },
          ],
        },
      ],
    };
  }

  // ADMIN and SUPER_ADMIN: Admin tasks only (incident reports, vehicle registration reviews, appeals)
  return {
    AND: [
      {
        userId: null, // Admin tasks are broadcast to administrators, not individual student alerts
      },
      {
        NOT: [
          { link: { startsWith: "/guard" } },
          { link: { startsWith: "/student" } },
          { title: { contains: "Vehicle Pass Approved", mode: "insensitive" as const } },
          { title: { contains: "Report Reviewed", mode: "insensitive" as const } },
          { title: { contains: "Report Disapproved", mode: "insensitive" as const } },
          { description: { contains: "Guard entries should be queued", mode: "insensitive" as const } },
        ],
      },
      {
        OR: [
          { link: { startsWith: "/admin" } },
          { title: { contains: "Incident", mode: "insensitive" as const } },
          { title: { contains: "Registration", mode: "insensitive" as const } },
          { title: { contains: "Appeal", mode: "insensitive" as const } },
          { title: { contains: "Claimed", mode: "insensitive" as const } },
          { title: { contains: "Gate", mode: "insensitive" as const } },
          { type: "alert" },
        ],
      },
    ],
  };
}

/**
 * 1. GET /api/guard/notifications & /api/admin/notifications
 * Returns live notifications, unread count, and tabs filtering
 */
adminNotificationRoutes.get("/", async (req, res, next) => {
  try {
    syncSystemNotifications().catch(() => {});

    const search = (req.query.search as string)?.trim() || "";
    const tab = (req.query.tab as string)?.trim() || "all"; // "all" | "unread" | "alerts" | "updates"
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;

    const userRole = req.user?.role || "ADMIN";
    const isGuard = userRole === "GUARD";
    const roleCriteria = getRoleNotificationCriteria(userRole);

    const whereCondition: any = {
      AND: [...roleCriteria.AND],
    };

    if (tab === "unread") {
      whereCondition.read = false;
    } else if (tab === "alerts") {
      whereCondition.type = { in: ["alert", "warning"] };
    } else if (tab === "updates") {
      whereCondition.type = "update";
    }

    if (search) {
      whereCondition.AND.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    const unreadWhere: any = {
      read: false,
      AND: [...roleCriteria.AND],
    };

    const [totalUnread, totalCount, notificationsList] = await Promise.all([
      db.notification.count({ where: unreadWhere }),
      db.notification.count({ where: roleCriteria }),
      db.notification.findMany({
        where: whereCondition,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const formattedNotifications = notificationsList.map((n) => {
      let link = n.link || null;
      if (isGuard) {
        if (link?.includes("/vehicle") || link?.includes("/registration")) {
          link = "/guard/registration";
        } else {
          link = "/guard/monitoring";
        }
      }

      return {
        id: String(n.id),
        title: n.title,
        description: n.description,
        time: formatTime(n.createdAt),
        type: (n.type as "alert" | "warning" | "update") || "alert",
        read: n.read,
        link,
      };
    });

    return res.status(200).json({
      success: true,
      notifications: formattedNotifications,
      unreadCount: totalUnread,
      totalCount,
      pagination: {
        page,
        limit,
        total: totalCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. PATCH /api/guard/notifications/:id/read & /api/admin/notifications/:id/read
 * Mark a single notification as read
 */
adminNotificationRoutes.patch("/:id/read", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    const userRole = req.user?.role || "ADMIN";
    const roleCriteria = getRoleNotificationCriteria(userRole);

    // Verify notification belongs to the calling role before updating
    const existing = await db.notification.findFirst({
      where: { id, ...roleCriteria },
    });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or access denied for your role",
      });
    }

    const updated = await db.notification.update({
      where: { id },
      data: { read: true },
    });

    const unreadCount = await db.notification.count({
      where: { read: false, ...roleCriteria },
    });

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      notification: updated,
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. PATCH /api/guard/notifications/mark-all-read & /api/admin/notifications/mark-all-read
 * Mark all notifications for the caller's role as read
 */
adminNotificationRoutes.patch("/mark-all-read", async (req, res, next) => {
  try {
    const userRole = req.user?.role || "ADMIN";
    const roleCriteria = getRoleNotificationCriteria(userRole);

    await db.notification.updateMany({
      where: { read: false, ...roleCriteria },
      data: { read: true },
    });

    return res.status(200).json({
      success: true,
      message: userRole === "GUARD"
        ? "Guard notifications marked as read"
        : "Admin notifications marked as read",
      unreadCount: 0,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. DELETE /api/admin/notifications/:id
 * Delete a notification (Admin-only operation)
 */
adminNotificationRoutes.delete("/:id", async (req, res, next) => {
  try {
    const userRole = req.user?.role;
    if (userRole === "GUARD") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Security Guards cannot delete notifications.",
      });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    const roleCriteria = getRoleNotificationCriteria(userRole || "ADMIN");

    const existing = await db.notification.findFirst({
      where: { id, ...roleCriteria },
    });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Notification not found or access denied",
      });
    }

    await db.notification.delete({
      where: { id },
    });

    const unreadCount = await db.notification.count({
      where: { read: false, ...roleCriteria },
    });

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
});
