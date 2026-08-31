import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { authRequired, optionalAuth } from "../auth.js";
import type { Dataset, DatasetTestCase } from "@prompt-playground/shared";

// Ownership helper: samples (userId null) are shared read-only; user datasets are private.
function isOwned(dataset: { isSample: boolean; userId: string | null }, userId?: string | null): boolean {
  if (dataset.isSample) return false; // samples are never editable
  return Boolean(userId && dataset.userId === userId);
}

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
  evaluationCriteria: z.array(z.string().trim().min(1, "Each criterion must be non-empty")).optional(),
  notes: z.string().trim().max(10_000).optional(),
  position: z.number().int().min(0).optional(),
});

const updateTestCaseSchema = z.object({
  input: z.string().trim().min(1, "Input is required").max(50_000).optional(),
  expectedOutput: z.string().trim().max(50_000).nullable().optional(),
  evaluationCriteria: z.array(z.string().trim().min(1, "Each criterion must be non-empty")).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const datasetsRouter = Router();

datasetsRouter.post("/datasets", authRequired, async (request, response, next) => {
  try {
    const payload = createDatasetSchema.parse(request.body);
    const dataset = await prisma.dataset.create({
      data: { name: payload.name, description: payload.description, useCase: payload.useCase, userId: request.user!.id },
    });
    response.status(201).json(toDataset(dataset, 0, request.user!.id));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.get("/datasets", optionalAuth, async (request, response, next) => {
  try {
    const requestedLimit = Number(request.query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 50;
    const userId = request.user?.id ?? null;
    const datasets = await prisma.dataset.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      where: { OR: [{ isSample: true }, { userId: userId ?? "00000000-0000-0000-0000-000000000000" }] },
      include: { _count: { select: { testCases: true } } },
    });
    response.json(datasets.map((dataset) => toDataset(dataset, dataset._count.testCases, request.user?.id)));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.get("/datasets/:id", optionalAuth, async (request, response, next) => {
  try {
    const dataset = await prisma.dataset.findUnique({
      where: { id: request.params.id },
      include: { testCases: { orderBy: { position: "asc" } } },
    });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    // Only allow viewing samples or the user's own datasets.
    if (!dataset.isSample && dataset.userId !== (request.user?.id ?? null)) {
      return response.status(404).json({ error: "Dataset not found" });
    }
    return response.json({
      ...toDataset(dataset, dataset.testCases.length),
      editable: isOwned(dataset, request.user?.id),
      testCases: dataset.testCases.map(toTestCase),
    });
  } catch (error) {
    return next(error);
  }
});

datasetsRouter.patch("/datasets/:id", authRequired, async (request, response, next) => {
  try {
    const payload = updateDatasetSchema.parse(request.body);
    const existing = await prisma.dataset.findUnique({ where: { id: request.params.id } });
    if (!existing) return response.status(404).json({ error: "Dataset not found" });
    if (existing.isSample) return response.status(403).json({ error: "Sample datasets are read-only" });
    if (existing.userId !== request.user!.id) return response.status(404).json({ error: "Dataset not found" });
    const dataset = await prisma.dataset.update({
      where: { id: request.params.id },
      data: payload,
      include: { _count: { select: { testCases: true } } },
    });
    response.json(toDataset(dataset, dataset._count.testCases, request.user!.id));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.delete("/datasets/:id", authRequired, async (request, response, next) => {
  try {
    const dataset = await prisma.dataset.findUnique({ where: { id: request.params.id } });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    if (dataset.isSample) return response.status(403).json({ error: "Sample datasets cannot be deleted" });
    if (dataset.userId !== request.user!.id) return response.status(404).json({ error: "Dataset not found" });
    await prisma.dataset.delete({ where: { id: request.params.id } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

datasetsRouter.post("/datasets/:id/test-cases", authRequired, async (request, response, next) => {
  try {
    const payload = createTestCaseSchema.parse(request.body);
    const dataset = await prisma.dataset.findUnique({ where: { id: request.params.id } });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    if (!isOwned(dataset, request.user!.id)) return response.status(403).json({ error: "Sample datasets are read-only" });
    const maxPosition = await prisma.datasetTestCase.aggregate({
      where: { datasetId: dataset.id },
      _max: { position: true },
    });
    const testCase = await prisma.datasetTestCase.create({
      data: {
        datasetId: dataset.id,
        input: payload.input,
        expectedOutput: payload.expectedOutput,
        ...(payload.evaluationCriteria === undefined
          ? {}
          : { evaluationCriteria: payload.evaluationCriteria ?? Prisma.JsonNull }),
        notes: payload.notes,
        position: payload.position ?? (maxPosition._max.position ?? -1) + 1,
      },
    });
    response.status(201).json(toTestCase(testCase));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.patch("/datasets/:datasetId/test-cases/:testCaseId", authRequired, async (request, response, next) => {
  try {
    const payload = updateTestCaseSchema.parse(request.body);
    const dataset = await prisma.dataset.findUnique({ where: { id: request.params.datasetId } });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    if (!isOwned(dataset, request.user!.id)) return response.status(403).json({ error: "Sample datasets are read-only" });
    const testCase = await prisma.datasetTestCase.update({
      where: { id: request.params.testCaseId, datasetId: request.params.datasetId },
      data: {
        input: payload.input,
        expectedOutput: payload.expectedOutput,
        ...(payload.evaluationCriteria === undefined
          ? {}
          : { evaluationCriteria: payload.evaluationCriteria ?? Prisma.JsonNull }),
        notes: payload.notes,
        position: payload.position,
      },
    });
    response.json(toTestCase(testCase));
  } catch (error) {
    next(error);
  }
});

datasetsRouter.delete("/datasets/:datasetId/test-cases/:testCaseId", authRequired, async (request, response, next) => {
  try {
    const dataset = await prisma.dataset.findUnique({ where: { id: request.params.datasetId } });
    if (!dataset) return response.status(404).json({ error: "Dataset not found" });
    if (!isOwned(dataset, request.user!.id)) return response.status(403).json({ error: "Sample datasets are read-only" });
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
  isSample: boolean;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDataset(dataset: DatasetWithCount, testCaseCount: number, userId?: string | null): Dataset {
  return {
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    useCase: dataset.useCase,
    isSample: Boolean((dataset as any).isSample),
    editable: isOwned(dataset, userId),
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
  evaluationCriteria: Prisma.JsonValue;
  notes: string | null;
  position: number;
};

function toTestCase(testCase: TestCaseRow): DatasetTestCase {
  return {
    id: testCase.id,
    datasetId: testCase.datasetId,
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    evaluationCriteria: Array.isArray(testCase.evaluationCriteria)
      ? testCase.evaluationCriteria.map((item) => String(item))
      : null,
    notes: testCase.notes,
    position: testCase.position,
  };
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}
