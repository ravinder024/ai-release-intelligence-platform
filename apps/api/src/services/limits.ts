import { prisma } from "../prisma.js";
import { FREE_SCENARIO_LIMIT } from "@prompt-playground/shared";
import { hasUnlimitedAccess } from "./usage.js";

/**
 * Scenario limits for standard (free) accounts.
 *
 * A free account may keep at most 30 scenarios in a dataset, and may not run an experiment whose
 * dataset has more than 30 scenarios. Admin, the configured Tester, and any username listed in
 * `FULL_ACCESS_USERNAMES` are exempt, matching the Platform Free credit policy.
 */
export { FREE_SCENARIO_LIMIT };

export class ScenarioLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioLimitError";
  }
}

/** Whether this account is subject to the 30-scenario limit. */
export async function isScenarioLimited(userId: string): Promise<boolean> {
  return !(await hasUnlimitedAccess(userId));
}

/**
 * Guard for adding a scenario to a dataset. Called before the insert so a dataset can never grow
 * past the limit; existing datasets created before the limit keep working, they just cannot grow.
 */
export async function assertCanAddScenario(userId: string, datasetId: string): Promise<void> {
  if (!(await isScenarioLimited(userId))) return;
  const count = await prisma.datasetTestCase.count({ where: { datasetId } });
  if (count >= FREE_SCENARIO_LIMIT) {
    throw new ScenarioLimitError(
      `Free accounts are limited to ${FREE_SCENARIO_LIMIT} scenarios per dataset. Remove a scenario or add your own API key for Full access.`,
    );
  }
}

/**
 * Guard for experiment creation/run. The dataset is the single source of scenarios, so an
 * experiment inherits its size — but a shared sample dataset is not covered by the per-dataset
 * limit above, so it is checked here too.
 */
export async function assertExperimentScenarioLimit(userId: string, datasetId: string): Promise<void> {
  if (!(await isScenarioLimited(userId))) return;
  const count = await prisma.datasetTestCase.count({ where: { datasetId } });
  if (count > FREE_SCENARIO_LIMIT) {
    throw new ScenarioLimitError(
      `Free accounts can run experiments on at most ${FREE_SCENARIO_LIMIT} scenarios. This dataset has ${count}. Pick a smaller dataset or add your own API key for Full access.`,
    );
  }
}
