const apiUrl = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    credentials: "include",
    headers: options?.body ? { "Content-Type": "application/json", ...options.headers } : options?.headers,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

import type { CreateExperimentRequest, Experiment, ExperimentDetail, ExperimentDecision, EvaluationRun, ModelId } from "@prompt-playground/shared";

export async function getExperiments(): Promise<Experiment[]> {
  return api.get<Experiment[]>("/api/experiments");
}

export async function getExperiment(id: string): Promise<ExperimentDetail> {
  return api.get<ExperimentDetail>(`/api/experiments/${id}`);
}

export async function createExperiment(payload: CreateExperimentRequest): Promise<Experiment> {
  return api.post<Experiment>("/api/experiments", payload);
}

export async function runExperiment(id: string): Promise<EvaluationRun> {
  return api.post<EvaluationRun>(`/api/experiments/${id}/run`, {});
}

export async function retryExperiment(
  id: string,
  models?: { baselineModel?: ModelId; candidateModel?: ModelId; evaluatorModel?: ModelId },
): Promise<{ retried: number; remaining: number }> {
  return api.post<{ retried: number; remaining: number }>(`/api/experiments/${id}/retry`, models ?? {});
}

export async function createIteration(
  id: string,
  payload: {
    candidatePrompt: string;
    candidateModel: ModelId;
    evaluatorModel?: ModelId;
    evaluatorThreshold?: number;
    evaluatorPrompt?: string;
  },
): Promise<Experiment> {
  return api.post<Experiment>(`/api/experiments/${id}/iterations`, payload);
}

export async function saveExperimentDecision(
  id: string,
  decision: ExperimentDecision,
  decisionNote?: string,
): Promise<Experiment> {
  return api.patch<Experiment>(`/api/experiments/${id}/decision`, { decision, decisionNote });
}
