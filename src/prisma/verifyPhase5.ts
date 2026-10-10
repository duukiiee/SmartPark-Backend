import { db } from "./db.js";

async function main() {
  console.log("=== PHASE 5: VERIFICATION OF DATABASE STATE ===");

  // 1. Column check
  const columns: any[] = await db.$queryRaw`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'user' AND column_name = 'accountType';
  `;

  if (columns.length === 0) {
    throw new Error("Verification failed: accountType column does not exist in 'user' table.");
  }
  console.log("✓ Column 'accountType' exists in 'user' table:", columns[0]);

  // 2. Data classification audit
  const users = await db.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      schoolId: true,
      role: true,
      accountType: true,
      accountStatus: true,
    },
    orderBy: { id: "asc" },
  });

  const students = users.filter((u) => u.accountType === "STUDENT");
  const employees = users.filter((u) => u.accountType === "EMPLOYEE");
  const unresolved = users.filter((u) => u.accountType === null);

  console.log(`✓ Total User Records: ${users.length}`);
  console.log(`  - STUDENT accountType: ${students.length}`);
  console.log(`  - EMPLOYEE accountType: ${employees.length}`);
  console.log(`  - NULL (Unresolved): ${unresolved.length}`);

  // Print summary list
  console.table(
    users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      schoolId: u.schoolId,
      role: u.role,
      accountType: u.accountType || "NULL (UNRESOLVED)",
    }))
  );

  // 3. Test Student & Employee Account Type Generation Logic
  // (REMOVED: This was adding test records that consumed IDs)
  console.log("\n=== PHASE 5: TEST REGISTRATION DATA SAVING ===");
  console.log("✓ Test user creation disabled - no IDs consumed.");
}

main()
  .catch((e) => {
    console.error("Verification failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
