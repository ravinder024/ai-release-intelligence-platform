import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDirectory, "../.env") });
dotenv.config({ path: resolve(currentDirectory, "../../../.env") });

const prisma = new PrismaClient();

const SAMPLE_NAME = "Customer Support";
const SAMPLE_USE_CASE = "support";
const SAMPLE_DESCRIPTION = "Realistic billing, account, and usage questions used to compare prompt tone, clarity, and completeness across support scenarios.";

const SAMPLE_SCENARIOS = [
  {
    input: "A customer says their monthly invoice is unexpectedly higher than usual. Draft a helpful response.",
    expectedOutput: "Acknowledge the concern, explain the likely cause, and offer a refund or itemized breakdown.",
    notes: "Billing escalation",
  },
  {
    input: "A customer asks how to cancel their subscription. They are worried it is hard to find in the app.",
    expectedOutput: "Give clear cancellation steps and reassure them there is no lock-in.",
    notes: "Retention risk",
  },
  {
    input: "A customer was charged twice for the same plan this month and wants it resolved quickly.",
    expectedOutput: "Apologize, confirm the duplicate charge, and explain the refund timeline.",
    notes: "Double charge",
  },
  {
    input: "A customer reports the product is slower than usual today and asks if there is an outage.",
    expectedOutput: "Check for known issues, set expectations, and share where status updates are posted.",
    notes: "Availability question",
  },
  {
    input: "A customer wants to change the credit card on file but cannot find the billing settings page.",
    expectedOutput: "Point them to the exact billing settings location and what to update.",
    notes: "Account management",
  },
  {
    input: "A customer asks how to download a copy of all their data for export.",
    expectedOutput: "Explain the export flow, what is included, and how long it takes.",
    notes: "Privacy / data export",
  },
  {
    input: "A customer suggests a new feature and asks whether it is on the roadmap.",
    expectedOutput: "Thank them, acknowledge the request, and explain how product requests are prioritized.",
    notes: "Feature request",
  },
];

async function main() {
  let dataset = await prisma.dataset.findFirst({ where: { name: SAMPLE_NAME } });
  if (!dataset) {
    dataset = await prisma.dataset.create({
      data: { name: SAMPLE_NAME, description: SAMPLE_DESCRIPTION, useCase: SAMPLE_USE_CASE },
    });
    console.log(`Created sample dataset "${SAMPLE_NAME}".`);
  } else {
    dataset = await prisma.dataset.update({
      where: { id: dataset.id },
      data: { description: SAMPLE_DESCRIPTION, useCase: SAMPLE_USE_CASE },
    });
    console.log(`Sample dataset "${SAMPLE_NAME}" already exists; keeping its history.`);
  }

  const existing = await prisma.datasetTestCase.findMany({
    where: { datasetId: dataset.id },
    select: { input: true },
  });
  const existingInputs = new Set(existing.map((testCase) => testCase.input));

  let added = 0;
  for (const scenario of SAMPLE_SCENARIOS) {
    if (existingInputs.has(scenario.input)) continue;
    const maxPosition = await prisma.datasetTestCase.aggregate({
      where: { datasetId: dataset.id },
      _max: { position: true },
    });
    await prisma.datasetTestCase.create({
      data: {
        datasetId: dataset.id,
        input: scenario.input,
        expectedOutput: scenario.expectedOutput,
        notes: scenario.notes,
        position: (maxPosition._max.position ?? -1) + 1,
      },
    });
    added++;
  }

  const total = existing.length + added;
  console.log(`Sample dataset "${SAMPLE_NAME}" ready with ${total} scenario(s) (added ${added}).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
