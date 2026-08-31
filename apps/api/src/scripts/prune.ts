import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Idempotent cleanup for a fresh demo deployment:
// deletes ALL user data + run history, keeping only the seeded sample datasets (isSample = true).
const currentDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDirectory, "../.env") });
dotenv.config({ path: resolve(currentDirectory, "../../../.env") });

const prisma = new PrismaClient();

export async function pruneData(): Promise<{ deletedRuns: number; deletedExperiments: number; deletedComparisons: number; deletedDatasets: number; deletedUsers: number; sampleCount: number }> {
  console.log("Pruning user data and non-sample datasets...");

  const deletedRuns = await prisma.evaluationRun.deleteMany({ where: { userId: { not: null } } });
  console.log(`Deleted ${deletedRuns.count} user evaluation run(s)`);

  const deletedExperiments = await prisma.experiment.deleteMany({ where: { userId: { not: null } } });
  console.log(`Deleted ${deletedExperiments.count} user experiment(s)`);

  const deletedComparisons = await prisma.promptComparison.deleteMany({ where: { userId: { not: null } } });
  console.log(`Deleted ${deletedComparisons.count} user comparison(s)`);

  // Also clear any orphaned non-sample datasets (and cascades to their test cases / runs).
  const deletedDatasets = await prisma.dataset.deleteMany({ where: { isSample: false } });
  console.log(`Deleted ${deletedDatasets.count} non-sample dataset(s)`);

  // Wipe accounts (sessions/reset tokens cascade) so the deployed app starts with zero users.
  const deletedUsers = await prisma.user.deleteMany({});
  console.log(`Deleted ${deletedUsers.count} user account(s)`);

  const sampleCount = await prisma.dataset.count({ where: { isSample: true } });
  console.log(`Keeping ${sampleCount} sample dataset(s).`);

  return { deletedRuns: deletedRuns.count, deletedExperiments: deletedExperiments.count, deletedComparisons: deletedComparisons.count, deletedDatasets: deletedDatasets.count, deletedUsers: deletedUsers.count, sampleCount };
}

async function main() {
  await pruneData();
}

// Only run automatically when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .catch((error) => {
      console.error("Prune failed:", error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { prisma };
