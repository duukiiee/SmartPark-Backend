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

/**
 * Auto-sync helper: creates notifications for pending incidents, vehicle registrations, approvals, or capacity warnings
 */
async function syncSystemNotifications() {
  try {
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
 * 1. GET /api/guard/notifications & /api/admin/notifications
 * Returns live notifications, unread count, and tabs filtering
 */
adminNotificationRoutes.get("/", async (req, res, next) => {
  try {
    await syncSystemNotifications();

    const search = (req.query.search as string)?.trim() || "";
    const tab = (req.query.tab as string)?.trim() || "all"; // "all" | "unread" | "alerts" | "updates"
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;

    const whereCondition: any = {};

    if (tab === "unread") {
      whereCondition.read = false;
    } else if (tab === "alerts") {
      whereCondition.type = { in: ["alert", "warning"] };
    } else if (tab === "updates") {
      whereCondition.type = "update";
    }

    if (search) {
      whereCondition.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [totalUnread, totalCount, notificationsList] = await Promise.all([
      db.notification.count({ where: { read: false } }),
      db.notification.count(),
      db.notification.findMany({
        where: whereCondition,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const isGuard = req.user?.role === "GUARD";

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
        total: notificationsList.length,
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

    const updated = await db.notification.update({
      where: { id },
      data: { read: true },
    });

    const unreadCount = await db.notification.count({ where: { read: false } });

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
 * Mark all notifications as read
 */
adminNotificationRoutes.patch("/mark-all-read", async (req, res, next) => {
  try {
    await db.notification.updateMany({
      where: { read: false },
      data: { read: true },
    });

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      unreadCount: 0,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. DELETE /api/guard/notifications/:id & /api/admin/notifications/:id
 * Delete a notification
 */
adminNotificationRoutes.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: "Invalid notification ID" });
    }

    await db.notification.delete({
      where: { id },
    });

    const unreadCount = await db.notification.count({ where: { read: false } });

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
});
