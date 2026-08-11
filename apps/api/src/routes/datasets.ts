import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import type { Dataset, DatasetTestCase } from "@prompt-playground/shared";

const createDatasetSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  description: z.string().trim().max(10_000).optional(),
  useCase: z.string().trim().max(160).optional(),
});

const updateDatasetSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  useCase: z.string().trim().max(160).nullable().optional(),
});

const createTestCaseSchema = z.object({
  input: z.string().trim().min(1, "Input is required").max(50_000),
  expectedOutput: z.string().trim().max(50_000).optional(),
  notes: z.string().trim().max(10_000).optional(),
  position: z.number().int().min(0).optional(),
});

const updateTestCaseSchema = z.object({
  input: z.string().trim().min(1, "Input is required").max(50_000).optional(),
  expectedOutput: z.string().trim().max(50_000).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const datasetsRouter = Router();

datasetsRouter.post("/datasets", async (request, response, next) => {
  try {
    const payload = createDatasetSchema.parse(request.body);
    const dataset = await prisma.dataset.create({
      data: { name: payload.name, description: payload.description, useCase: payload.useCase },
    });
    response.status(201).json(toDataset(dataset, 0));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.get("/datasets", async (request, response, next) => {
  try {
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 50;
    const datasets = await prisma.dataset.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { testCases: true } } },
    });
    response.json(datasets.map((dataset) => toDataset(dataset, dataset._count.testCases)));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.get("/datasets/:id", async (request, response, next) => {
  try {
    const dataset = await prisma.dataset.findUnique({
      where: { id: request.params.id },
      include: { testCases: { orderBy: { position: "asc" } } },
    });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    return response.json({
      ...toDataset(dataset, dataset.testCases.length),
      testCases: dataset.testCases.map(toTestCase),
    });
  } catch (error) {
    return next(error);
  }
});

datasetsRouter.patch("/datasets/:id", async (request, response, next) => {
  try {
    const payload = updateDatasetSchema.parse(request.body);
    const dataset = await prisma.dataset.update({
      where: { id: request.params.id },
      data: payload,
      include: { _count: { select: { testCases: true } } },
    });
    response.json(toDataset(dataset, dataset._count.testCases));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.delete("/datasets/:id", async (request, response, next) => {
  try {
    await prisma.dataset.delete({ where: { id: request.params.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

datasetsRouter.post("/datasets/:id/test-cases", async (request, response, next) => {
  try {
    const payload = createTestCaseSchema.parse(request.body);
    const dataset = await prisma.dataset.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    const maxPosition = await prisma.datasetTestCase.aggregate({
      where: { datasetId: dataset.id },
      _max: { position: true },
    });
    const testCase = await prisma.datasetTestCase.create({
      data: {
        datasetId: dataset.id,
        input: payload.input,
        expectedOutput: payload.expectedOutput,
        notes: payload.notes,
        position: payload.position ?? (maxPosition._max.position ?? -1) + 1,
      },
    });
    response.status(201).json(toTestCase(testCase));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.patch("/datasets/:datasetId/test-cases/:testCaseId", async (request, response, next) => {
  try {
    const payload = updateTestCaseSchema.parse(request.body);
    const testCase = await prisma.datasetTestCase.update({
      where: { id: request.params.testCaseId, datasetId: request.params.datasetId },
      data: payload,
    });
    response.json(toTestCase(testCase));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.delete("/datasets/:datasetId/test-cases/:testCaseId", async (request, response, next) => {
  try {
    await prisma.datasetTestCase.delete({
      where: { id: request.params.testCaseId, datasetId: request.params.datasetId },
    });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

type DatasetWithCount = {
  id: string;
  name: string;
  description: string | null;
  useCase: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDataset(dataset: DatasetWithCount, testCaseCount: number): Dataset {
  return {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    useCase: dataset.useCase,
    createdAt: dataset.createdAt.toISOString(),
    updatedAt: dataset.updatedAt.toISOString(),
    testCaseCount,
  };
}

type TestCaseRow = {
  id: string;
  datasetId: string;
  input: string;
  expectedOutput: string | null;
  notes: string | null;
  position: number;
};

function toTestCase(testCase: TestCaseRow): DatasetTestCase {
  return {
    id: testCase.id,
    datasetId: testCase.datasetId,
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    notes: testCase.notes,
    position: testCase.position,
  };
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}
