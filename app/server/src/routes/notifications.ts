/**
 * Notification center routes: event log, read marker, sink settings, test.
 */
import { Router } from "express";
import { z } from "zod";
import {
  getNotifications,
  getSettings,
  markAllRead,
  saveSettings,
  sendTest,
  type NotificationSettings,
} from "../services/notifications.js";
import { asyncHandler } from "../util/errors.js";

export const notificationsRouter = Router();

const severitySchema = z.enum(["info", "warning", "critical"]);

const settingsSchema = z.object({
  minSeverity: severitySchema,
  thresholds: z.object({
    diskPct: z.number().int().min(1).max(100),
    tempC: z.number().int().min(20).max(120),
  }),
  sinks: z.object({
    ntfy: z.object({
      enabled: z.boolean(),
      url: z.string().max(512),
      topic: z.string().max(256),
    }),
    webhook: z.object({
      enabled: z.boolean(),
      url: z.string().max(512),
    }),
    telegram: z.object({
      enabled: z.boolean(),
      botToken: z.string().max(256),
      chatId: z.string().max(64),
    }),
  }),
});

// GET /api/notifications
notificationsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await getNotifications());
  }),
);

// POST /api/notifications/read
notificationsRouter.post(
  "/read",
  asyncHandler(async (_req, res) => {
    await markAllRead();
    res.status(204).end();
  }),
);

// GET /api/notifications/settings
notificationsRouter.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    res.json(await getSettings());
  }),
);

// PUT /api/notifications/settings
notificationsRouter.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const body: NotificationSettings = settingsSchema.parse(req.body);
    res.json(await saveSettings(body));
  }),
);

// POST /api/notifications/test
notificationsRouter.post(
  "/test",
  asyncHandler(async (_req, res) => {
    res.json({ results: await sendTest() });
  }),
);
