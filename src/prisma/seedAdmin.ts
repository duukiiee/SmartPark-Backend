import bcrypt from "bcryptjs";
import { db } from "./db.js";

async function main() {
  // 1. Seed Super Admin
  const superAdminEmail = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || "superadmin@gmail.com";
  const superAdminPassword = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || "SuperAdmin123!";
  const superAdminSchoolId = process.env.BOOTSTRAP_SUPER_ADMIN_ID || "SA-0000001";
  const superAdminFirstName = process.env.BOOTSTRAP_SUPER_ADMIN_FIRSTNAME || "Super";
  const superAdminLastName = process.env.BOOTSTRAP_SUPER_ADMIN_LASTNAME || "Admin";

  const existingSuperAdmin = await db.user.findFirst({
    where: {
      OR: [{ email: superAdminEmail.toLowerCase() }, { schoolId: superAdminSchoolId }],
    },
  });

  if (!existingSuperAdmin) {
    const hashedSuperAdminPassword = await bcrypt.hash(superAdminPassword, 10);
    const superAdmin = await db.user.create({
      data: {
        firstName: superAdminFirstName,
        lastName: superAdminLastName,
        email: superAdminEmail.toLowerCase(),
        schoolId: superAdminSchoolId,
        password: hashedSuperAdminPassword,
        role: "SUPER_ADMIN",
        accountType: "EMPLOYEE",
        accountStatus: "Active",
      },
    });
    console.log(`[Seed] Super Admin user created successfully with ID: ${superAdmin.id} (${superAdmin.email})`);
  } else {
    console.log(`[Seed] Super Admin user already exists with ID: ${existingSuperAdmin.id} (${existingSuperAdmin.email})`);
  }

  // 2. Seed Regular Admin
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@qcu.edu.ph";
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "Admin123!";
  const adminSchoolId = process.env.BOOTSTRAP_ADMIN_ID || "AD-0000001";
  const adminFirstName = process.env.BOOTSTRAP_ADMIN_FIRSTNAME || "System";
  const adminLastName = process.env.BOOTSTRAP_ADMIN_LASTNAME || "Admin";

  const existingAdmin = await db.user.findFirst({
    where: {
      OR: [{ email: adminEmail.toLowerCase() }, { schoolId: adminSchoolId }],
    },
  });

  if (!existingAdmin) {
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
  } else {
    console.log(`[Seed] Admin user already exists with ID: ${existingAdmin.id} (${existingAdmin.email})`);
  }

  // 3. Seed Default Guard account
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
