import { Router } from "express";
import { supportedModels } from "@prompt-playground/shared";

export const modelsRouter = Router();

modelsRouter.get("/models", (_request, response) => response.json({ models: supportedModels }));
