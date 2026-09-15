import { prisma } from "../prisma.js";

/**
 * Backfills ownership for records created before user ownership was enforced.
 *
 * Evaluation runs created by experiments previously omitted userId, which allowed
 * a run to be reachable without an owner. This script attributes those runs to the
 * owning experiment, and attributes dataset-linked runs to the dataset owner.
 */
async function main() {
  const experiments = await prisma.experiment.findMany({
    where: { userId: { not: null } },
    select: { id: true, userId: true },
  });

  let attributedToExperiment = 0;
  for (const experiment of experiments) {
    const result = await prisma.evaluationRun.updateMany({
      where: { experimentId: experiment.id, userId: null },
      data: { userId: experiment.userId },
    });
    attributedToExperiment += result.count;
  }

  const datasets = await prisma.dataset.findMany({
    where: { userId: { not: null } },
    select: { id: true, userId: true },
  });

  let attributedToDataset = 0;
  for (const dataset of datasets) {
    const result = await prisma.evaluationRun.updateMany({
      where: { datasetId: dataset.id, userId: null, experimentId: null },
      data: { userId: dataset.userId },
    });
    attributedToDataset += result.count;
  }

  const remaining = await prisma.evaluationRun.count({ where: { userId: null } });
  console.log(`Attributed ${attributedToExperiment} run(s) from experiments.`);
  console.log(`Attributed ${attributedToDataset} run(s) from datasets.`);
  console.log(`${remaining} run(s) remain without an owner (legacy or sample-linked). Review before enforcing strict constraints.`);
}

main()
  .catch((error) => {
    console.error("Ownership backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
