import bcrypt from "bcryptjs";
import { db } from "./db.js";

async function main() {
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const adminSchoolId = process.env.BOOTSTRAP_ADMIN_ID;
  const adminFirstName = process.env.BOOTSTRAP_ADMIN_FIRSTNAME || "System";
  const adminLastName = process.env.BOOTSTRAP_ADMIN_LASTNAME || "Admin";

  if (!adminEmail || !adminPassword || !adminSchoolId) {
    throw new Error(
      "[Seed Security Error] Bootstrap admin credentials are missing in environment variables. BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, and BOOTSTRAP_ADMIN_ID must be explicitly set."
    );
  }

  const existingAdmin = await db.user.findFirst({
    where: {
      OR: [{ email: adminEmail.toLowerCase() }, { schoolId: adminSchoolId }],
    },
  });

  if (existingAdmin) {
    console.log(`[Seed] Admin user already exists with ID: ${existingAdmin.id} (${existingAdmin.email})`);
    return;
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = await db.user.create({
    data: {
      firstName: adminFirstName,
      lastName: adminLastName,
      email: adminEmail.toLowerCase(),
      schoolId: adminSchoolId,
      password: hashedPassword,
      role: "ADMIN",
      accountType: "EMPLOYEE",
      accountStatus: "Active",
    },
  });

  console.log(`[Seed] Initial Admin user created successfully with ID: ${admin.id} (${admin.email})`);

  // Create default Guard account
  const guardEmail = process.env.BOOTSTRAP_GUARD_EMAIL || "guard@qcu.edu.ph";
  const guardPassword = process.env.BOOTSTRAP_GUARD_PASSWORD || "Guard123!";
  const guardSchoolId = process.env.BOOTSTRAP_GUARD_ID || "GD-0000001";

  const existingGuard = await db.user.findFirst({
    where: { OR: [{ email: guardEmail.toLowerCase() }, { schoolId: guardSchoolId }] },
  });

  if (!existingGuard) {
    const hashedGuardPassword = await bcrypt.hash(guardPassword, 10);
    const guard = await db.user.create({
      data: {
        firstName: "Security",
        lastName: "Guard",
        email: guardEmail.toLowerCase(),
        schoolId: guardSchoolId,
        password: hashedGuardPassword,
        role: "GUARD",
        accountType: "EMPLOYEE",
        accountStatus: "Active",
      },
    });
    console.log(`[Seed] Initial Guard user created successfully with ID: ${guard.id} (${guard.email})`);
  } else {
    console.log(`[Seed] Guard user already exists with ID: ${existingGuard.id} (${existingGuard.email})`);
  }
}

main()
  .catch((e) => {
    console.error("[Seed Error]", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
