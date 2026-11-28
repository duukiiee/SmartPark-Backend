import { db } from "../prisma/db";

export interface GetGateVehiclesParams {
  search?: string | undefined;
  status?: "Active" | "Deactivated" | undefined;
  vehicleType?: string | undefined;
  page: number;
  limit: number;
  cursor?: number | undefined;
}

/**
 * Optimized query to fetch gate vehicles with their latest parking logs
 * Uses batch loading instead of nested selects to avoid N+1 problems
 */
export async function getGateVehiclesOptimized(params: GetGateVehiclesParams) {
  const { search, status, vehicleType, page, limit, cursor } = params;

  // Build where clause
  const where: any = {
    registrationSource: "Gate",
  };

  if (status === "Active") {
    where.status = "Approved";
  } else if (status === "Deactivated") {
    where.status = { not: "Approved" };
  }

  if (
    vehicleType &&
    vehicleType !== "All Vehicles" &&
    vehicleType !== "All Vehicle"
  ) {
    where.type = vehicleType;
  }

  if (search && search.trim()) {
    const s = search.trim();
    where.OR = [
      { plateNumber: { contains: s, mode: "insensitive" } },
      { model: { contains: s, mode: "insensitive" } },
      { brand: { contains: s, mode: "insensitive" } },
      { ownerName: { contains: s, mode: "insensitive" } },
      { rejectionReason: { contains: s, mode: "insensitive" } },
    ];
  }

  // Count total matching vehicles
  const total = await db.vehicle.count({ where });
  const totalPages = Math.ceil(total / limit) || 1;
  const safePage = Math.max(1, page);

  // Fetch vehicles without nested relations (Query 1)
  const paginationArgs = {
    where,
    take: limit,
    orderBy: { createdAt: "desc" as const },
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
    },
  };

  const queryArgs =
    cursor !== undefined
      ? { ...paginationArgs, skip: 1, cursor: { id: cursor } }
      : { ...paginationArgs, skip: (safePage - 1) * limit };

  const gateVehicles = await db.vehicle.findMany(queryArgs);

  // Batch fetch latest parking logs for all vehicles (Query 2)
  const vehicleIds = gateVehicles.map((v) => v.id);

  let parkingLogsByVehicle: Record<number, any> = {};

  if (vehicleIds.length > 0) {
    const latestLogs = await db.$queryRaw`
      SELECT DISTINCT ON ("vehicleId")
        id,
        "vehicleId",
        "entryTime",
        "exitTime",
        duration,
        status,
        "guardName"
      FROM parking_log
      WHERE "vehicleId" = ANY(${vehicleIds}::int[])
      ORDER BY "vehicleId", "entryTime" DESC
    `;

    // Map logs by vehicle ID for O(1) lookup
    parkingLogsByVehicle = (latestLogs as any[]).reduce(
      (acc, log) => {
        acc[log.vehicleId] = log;
        return acc;
      },
      {} as Record<number, any>,
    );
  }

  return {
    vehicles: gateVehicles,
    parkingLogs: parkingLogsByVehicle,
    total,
    totalPages,
  };
}
