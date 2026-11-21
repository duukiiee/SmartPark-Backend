import { Router } from "express";
import { db } from "../prisma/db.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

export const adminIncidentRoutes = Router();
export const publicIncidentRoutes = Router();

const defaultOwnersMap: Record<string, { ownerName: string; ownerEmail: string; ownerPhone: string }> = {
  "GHI9091": { ownerName: "Daniel Cruz", ownerEmail: "daniel.cruz@email.com", ownerPhone: "0917 456 7708" },
  "NDG5214": { ownerName: "Maria Santos", ownerEmail: "maria.santos@qcu.edu.ph", ownerPhone: "0912 345 6789" },
  "UNKNOWN": { ownerName: "N/A", ownerEmail: "N/A", ownerPhone: "N/A" },
  "ABC1234": { ownerName: "Juan Dela Cruz", ownerEmail: "juan@qcu.edu.ph", ownerPhone: "0919 888 7766" },
  "XYZ9876": { ownerName: "Pedro Penduko", ownerEmail: "pedro@qcu.edu.ph", ownerPhone: "0922 333 4455" },
};

// Ensure initial realistic incident linked to the database vehicle if table is empty
async function seedInitialIncidentsIfEmpty() {
  const count = await db.incident.count();
  if (count === 0) {
    const realVehicle = await db.vehicle.findFirst({
      include: {
        user: true,
      },
    });

    if (realVehicle) {
      await db.incident.create({
        data: {
          referenceId: "INC-2026-001",
          userId: null,
          reporterName: "Security Guard",
          reporterEmail: "guard@qcu.edu.ph",
          reporterPhone: "0918 123 4567",
          vehicleType: realVehicle.type || "Car",
          plateNumber: realVehicle.plateNumber,
          model: `${realVehicle.brand} ${realVehicle.model}`,
          color: realVehicle.color,
          reportType: "Obstruction",
          status: "Pending",
          description: "Overlapping into adjacent slot.",
          evidenceImage: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=600&auto=format&fit=crop&q=60",
          createdAt: new Date(),
        },
      });
    }
  }
}

// ----------------------------------------------------
// ADMIN ROUTES (/api/admin/incidents)
// ----------------------------------------------------
adminIncidentRoutes.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN", "GUARD"));

/**
 * 1. GET /api/admin/incidents
 * List all incident reports with metrics, tabs, search, and pagination
 */
adminIncidentRoutes.get("/", async (req, res, next) => {
  try {
    await seedInitialIncidentsIfEmpty();

    const search = (req.query.search as string)?.trim() || "";
    const status = (req.query.status as string)?.trim() || "All";
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const skip = (page - 1) * limit;

    // Fetch all vehicles to cross-reference registered owners by plate
    const registeredVehicles = await db.vehicle.findMany({
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    const vehicleMap = new Map<string, any>();
    registeredVehicles.forEach((v) => {
      if (v.plateNumber) {
        vehicleMap.set(v.plateNumber.toUpperCase().replace(/\s+/g, ""), v);
      }
    });

    // Build Prisma query condition
    const where: any = {};

    if (status !== "All") {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { referenceId: { contains: search, mode: "insensitive" } },
        { plateNumber: { contains: search, mode: "insensitive" } },
        { reporterName: { contains: search, mode: "insensitive" } },
        { model: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, incidents] = await Promise.all([
      db.incident.count({ where }),
      db.incident.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    // Metrics calculations
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [waitingForReview, reviewedThisWeek, reviewedToday, totalIncidents] = await Promise.all([
      db.incident.count({ where: { status: "Pending" } }),
      db.incident.count({ where: { status: { in: ["Reviewed", "Rejected"] }, updatedAt: { gte: sevenDaysAgo } } }),
      db.incident.count({ where: { status: { in: ["Reviewed", "Rejected"] }, updatedAt: { gte: startOfToday } } }),
      db.incident.count(),
    ]);

    // Format incidents for frontend table
    const formattedIncidents = incidents.map((inc) => {
      const cleanPlate = inc.plateNumber ? inc.plateNumber.toUpperCase().replace(/\s+/g, "") : "";
      const matchedVehicle = vehicleMap.get(cleanPlate);

      let ownerName = "N/A";
      let ownerEmail = "N/A";
      let ownerPhone = "N/A";

      if (matchedVehicle?.user) {
        ownerName = `${matchedVehicle.user.firstName} ${matchedVehicle.user.lastName}`;
        ownerEmail = matchedVehicle.user.email || "N/A";
        ownerPhone = matchedVehicle.user.phone || "N/A";
      } else if (defaultOwnersMap[cleanPlate]) {
        ownerName = defaultOwnersMap[cleanPlate].ownerName;
        ownerEmail = defaultOwnersMap[cleanPlate].ownerEmail;
        ownerPhone = defaultOwnersMap[cleanPlate].ownerPhone;
      }

      const submittedFormatted = inc.createdAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      return {
        id: inc.id,
        ref: inc.referenceId,
        reporter: inc.reporterName,
        reporterEmail: inc.reporterEmail || "--",
        reporterPhone: inc.reporterPhone || "--",
        type: inc.vehicleType,
        model: inc.model || "--",
        color: inc.color || "--",
        plate: inc.plateNumber,
        reportType: inc.reportType,
        status: inc.status,
        desc: inc.description,
        evidenceImg:
          inc.evidenceImage ||
          "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=600&auto=format&fit=crop&q=60",
        submitted: submittedFormatted,
        action: inc.status === "Pending" ? "Review" : "View",
        rejectionReason: inc.rejectionReason,
        reviewedBy: inc.reviewedBy,
        reviewedAt: inc.reviewedAt,
        ownerName,
        ownerEmail,
        ownerPhone,
      };
    });

    return res.status(200).json({
      success: true,
      incidents: formattedIncidents,
      metrics: {
        waitingForReview,
        reviewedThisWeek,
        reviewedToday,
        totalIncidents,
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. GET /api/admin/incidents/:id
 * Retrieve single incident report with matched vehicle owner details
 */
adminIncidentRoutes.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const incident = await db.incident.findFirst({
      where: {
        OR: isNaN(id) ? [{ referenceId: req.params.id }] : [{ id }, { referenceId: req.params.id }],
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            schoolId: true,
          },
        },
      },
    });

    if (!incident) {
      return res.status(404).json({ success: false, message: "Incident report not found" });
    }

    // Cross reference vehicle owner by plate number
    let matchedVehicle = null;
    if (incident.plateNumber && incident.plateNumber !== "Unknown") {
      matchedVehicle = await db.vehicle.findFirst({
        where: {
          plateNumber: {
            equals: incident.plateNumber,
            mode: "insensitive",
          },
        },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              schoolId: true,
            },
          },
        },
      });
    }

    const cleanPlate = incident.plateNumber ? incident.plateNumber.toUpperCase().replace(/\s+/g, "") : "";
    let ownerName = "N/A";
    let ownerEmail = "N/A";
    let ownerPhone = "N/A";

    if (matchedVehicle?.user) {
      ownerName = `${matchedVehicle.user.firstName} ${matchedVehicle.user.lastName}`;
      ownerEmail = matchedVehicle.user.email || "N/A";
      ownerPhone = matchedVehicle.user.phone || "N/A";
    } else if (defaultOwnersMap[cleanPlate]) {
      ownerName = defaultOwnersMap[cleanPlate].ownerName;
      ownerEmail = defaultOwnersMap[cleanPlate].ownerEmail;
      ownerPhone = defaultOwnersMap[cleanPlate].ownerPhone;
    }

    const submittedFormatted = incident.createdAt.toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    return res.status(200).json({
      success: true,
      incident: {
        id: incident.id,
        ref: incident.referenceId,
        reporter: incident.reporterName,
        reporterEmail: incident.reporterEmail || incident.user?.email || "--",
        reporterPhone: incident.reporterPhone || incident.user?.phone || "--",
        type: incident.vehicleType,
        model: incident.model || "--",
        color: incident.color || "--",
        plate: incident.plateNumber,
        reportType: incident.reportType,
        status: incident.status,
        desc: incident.description,
        evidenceImg:
          incident.evidenceImage ||
          "https://images.unsplash.com/photo-1502877338535-766e1452684a?w=600&auto=format&fit=crop&q=60",
        submitted: submittedFormatted,
        rejectionReason: incident.rejectionReason,
        reviewedBy: incident.reviewedBy,
        reviewedAt: incident.reviewedAt,
        ownerName,
        ownerEmail,
        ownerPhone,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 3. PATCH /api/admin/incidents/:id/review
 * Mark an incident report as Reviewed or Rejected with a recorded reason
 */
adminIncidentRoutes.patch("/:id/review", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { action, rejectionReason } = req.body;

    if (!action || !["Reviewed", "Rejected"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Action must be either 'Reviewed' or 'Rejected'",
      });
    }

    if (action === "Rejected" && (!rejectionReason || !rejectionReason.trim())) {
      return res.status(400).json({
        success: false,
        message: "A rejection reason is required when rejecting a report.",
      });
    }

    const targetIncident = await db.incident.findFirst({
      where: {
        OR: isNaN(id) ? [{ referenceId: req.params.id }] : [{ id }, { referenceId: req.params.id }],
      },
    });

    if (!targetIncident) {
      return res.status(404).json({ success: false, message: "Incident report not found" });
    }

    const reviewerId = req.user?.id;
    let reviewerName = "Admin";
    if (reviewerId) {
      const reviewerUser = await db.user.findUnique({
        where: { id: reviewerId },
        select: { firstName: true, lastName: true },
      });
      if (reviewerUser) {
        reviewerName = `${reviewerUser.firstName} ${reviewerUser.lastName}`;
      }
    }

    const updated = await db.incident.update({
      where: { id: targetIncident.id },
      data: {
        status: action,
        rejectionReason: action === "Rejected" ? rejectionReason.trim() : null,
        reviewedBy: reviewerName,
        reviewedAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: `Incident report marked as ${action} successfully.`,
      incident: updated,
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------
// STUDENT / USER ROUTES (/api/incidents)
// ----------------------------------------------------
publicIncidentRoutes.use(requireAuth);

/**
 * 4. POST /api/incidents
 * Submit a new incident report from student portal
 */
publicIncidentRoutes.post("/", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const { vehicleType, color, model, plateNumber, reportType, description, evidenceImage } = req.body;

    if (!vehicleType || !plateNumber || !reportType) {
      return res.status(400).json({
        success: false,
        message: "Vehicle type, plate number, and report type are required.",
      });
    }

    const reporter = await db.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, phone: true },
    });

    const reporterName = reporter ? `${reporter.firstName} ${reporter.lastName}` : "Anonymous Reporter";

    // Generate unique reference ID like INC-2026-XXXXXX with retry on collision
    let referenceId = "";
    let created = false;
    let newIncident;

    for (let attempt = 0; attempt < 5; attempt++) {
      const randomSuffix = Math.floor(100000 + Math.random() * 900000);
      referenceId = `INC-2026-${randomSuffix}`;

      try {
        newIncident = await db.incident.create({
          data: {
            referenceId,
            userId,
            reporterName,
            reporterEmail: reporter?.email || null,
            reporterPhone: reporter?.phone || null,
            vehicleType,
            color: color || "--",
            model: model || "--",
            plateNumber: plateNumber.trim().toUpperCase(),
            reportType,
            description: description || "No additional description provided.",
            evidenceImage: evidenceImage || null,
            status: "Pending",
          },
        });
        created = true;
        break;
      } catch (err: any) {
        if (err.code === "P2002" && attempt < 4) {
          continue;
        }
        throw err;
      }
    }

    if (!created || !newIncident) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate unique incident reference ID. Please try again.",
      });
    }

    // Notify admins & guards about the new incident report
    try {
      await db.notification.create({
        data: {
          title: `New Incident: ${reportType}`,
          description: `${vehicleType} (${plateNumber.trim().toUpperCase()}) reported by ${reporterName}: ${description?.slice(0, 75) || "Check incident details."}`,
          type: "alert",
          link: `/admin/incidents/review/${newIncident.id}`,
          read: false,
          createdAt: new Date(),
        },
      });
    } catch (notifErr) {
      console.error("Failed to emit incident notification:", notifErr);
    }

    return res.status(201).json({
      success: true,
      message: "Incident report submitted successfully.",
      incident: newIncident,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 5. GET /api/incidents/my-reports
 * List reports filed by the logged-in user
 */
publicIncidentRoutes.get("/my-reports", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const reports = await db.incident.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      reports,
    });
  } catch (err) {
    next(err);
  }
});
