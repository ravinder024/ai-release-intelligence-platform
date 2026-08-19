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
      data: { name: SAMPLE_NAME, description: SAMPLE_DESCRIPTION, useCase: SAMPLE_USE_CASE, isSample: true },
    });
    console.log(`Created sample dataset "${SAMPLE_NAME}".`);
  } else {
    dataset = await prisma.dataset.update({
      where: { id: dataset.id },
      data: { description: SAMPLE_DESCRIPTION, useCase: SAMPLE_USE_CASE, isSample: true },
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

  // Travel - Flights sample dataset (~15 scenarios)
  const TRAVEL_NAME = "Travel - Flights";
  const TRAVEL_USE_CASE = "travel";
  const TRAVEL_DESCRIPTION = "Common flight booking and itinerary scenarios for evaluating travel assistant behavior.";

  const TRAVEL_SCENARIOS = [
    { input: "I need to book a one-way flight from NYC to LAX next Friday in the morning. What are my options?", expectedOutput: "Show flight options, times, carriers, and price ranges.", notes: "Basic search" },
    { input: "Can you find the cheapest round-trip tickets from London to Paris for next month?", expectedOutput: "Return cheapest options and note layovers.", notes: "Price-sensitive search" },
    { input: "I have a tight connection in Chicago with 45 minutes between flights, is that enough time?", expectedOutput: "Advise whether connection is safe and suggest alternatives.", notes: "Connection advice" },
    { input: "What's the baggage allowance for my ticket if I fly economy on Delta?", expectedOutput: "State typical allowances and link to carrier policy.", notes: "Baggage question" },
    { input: "I need to change my flight date but the website says fees apply. How do I proceed?", expectedOutput: "Explain change process and fee estimation.", notes: "Change fees" },
    { input: "Is it possible to reserve a seat with extra legroom on a basic economy fare?", expectedOutput: "Explain seat selection policies and options.", notes: "Seat selection" },
    { input: "My flight was cancelled and I need rebooking options. What are my rights?", expectedOutput: "Provide rebooking steps and compensation info.", notes: "Cancellations" },
    { input: "How do I add a frequent flyer number to an existing reservation?", expectedOutput: "Steps to add FF number and verify accrual.", notes: "Loyalty program" },
    { input: "Are pets allowed in-cabin on international flights to Spain?", expectedOutput: "Explain carrier pet policies and documentation needed.", notes: "Pet travel" },
    { input: "I lost my boarding pass email, how can I check in at the airport?", expectedOutput: "Guide to airport check-in and ID requirements.", notes: "Check-in support" },
    { input: "What's the best way to get from the airport to downtown by public transit?", expectedOutput: "Suggest transit options and approximate travel times.", notes: "Ground transport" },
    { input: "Can I request a special meal for my flight? How far in advance?", expectedOutput: "Explain meal request process and timing.", notes: "Special requests" },
    { input: "I need assistance boarding due to limited mobility. How do I arrange this?", expectedOutput: "Provide assistance request steps and contact info.", notes: "Accessibility" },
    { input: "Are there any COVID-19 testing requirements for entering Canada right now?", expectedOutput: "Provide current guidance and link to official sources.", notes: "Travel restrictions" },
    { input: "What's the difference between refundable and non-refundable fares?", expectedOutput: "Explain refund policy and change flexibility.", notes: "Fare rules" },
  ];

  let travelDataset = await prisma.dataset.findFirst({ where: { name: TRAVEL_NAME } });
  if (!travelDataset) {
    travelDataset = await prisma.dataset.create({ data: { name: TRAVEL_NAME, description: TRAVEL_DESCRIPTION, useCase: TRAVEL_USE_CASE, isSample: true } });
    console.log(`Created sample dataset "${TRAVEL_NAME}".`);
  } else {
    travelDataset = await prisma.dataset.update({ where: { id: travelDataset.id }, data: { description: TRAVEL_DESCRIPTION, useCase: TRAVEL_USE_CASE, isSample: true } });
    console.log(`Sample dataset "${TRAVEL_NAME}" already exists; keeping its history.`);
  }

  const existingTravel = await prisma.datasetTestCase.findMany({ where: { datasetId: travelDataset.id }, select: { input: true } });
  const existingTravelInputs = new Set(existingTravel.map((t) => t.input));
  let addedTravel = 0;
  for (const scenario of TRAVEL_SCENARIOS) {
    if (existingTravelInputs.has(scenario.input)) continue;
    const maxPosition = await prisma.datasetTestCase.aggregate({ where: { datasetId: travelDataset.id }, _max: { position: true } });
    await prisma.datasetTestCase.create({ data: { datasetId: travelDataset.id, input: scenario.input, expectedOutput: scenario.expectedOutput, notes: scenario.notes, position: (maxPosition._max.position ?? -1) + 1 } });
    addedTravel++;
  }
  const totalTravel = existingTravel.length + addedTravel;
  console.log(`Sample dataset "${TRAVEL_NAME}" ready with ${totalTravel} scenario(s) (added ${addedTravel}).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
