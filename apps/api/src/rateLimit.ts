import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };

/** Small single-process limiter suitable for the current one-VPS deployment. */
export function rateLimit(options: { windowMs: number; max: number; name: string }) {
  const buckets = new Map<string, Bucket>();
  return (request: Request, response: Response, next: NextFunction): void => {
    const now = Date.now();
    const forwarded = request.headers["x-forwarded-for"];
    const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : request.ip;
    const key = `${options.name}:${ip}`;
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > options.max) {
      response.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      response.status(429).json({ error: "Too many requests. Please try again shortly." });
      return;
    }
    next();
  };
}
