import { prisma } from "../prisma.js";

async function main() {
  const result = await prisma.session.deleteMany({});
  console.log(`Invalidated ${result.count} session(s).`);
}

main()
  .catch((error) => {
    console.error("Could not invalidate sessions:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
