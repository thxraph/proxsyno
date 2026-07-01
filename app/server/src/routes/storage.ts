/**
 * Read-only storage routes: disks, md RAID, ZFS pools, and SMART per disk.
 */
import { Router } from "express";
import { z } from "zod";
import { getSmart, listBlockDevices, listRaidArrays, listZfsPools } from "../services/storage.js";
import {
  cancelScrub,
  getScrubStatus,
  setScrubSchedule,
  startScrub,
  type ScrubSchedule,
} from "../services/scrub.js";
import {
  cancelSelfTest,
  getSelfTestStatus,
  setSelfTestSchedule,
  startSelfTest,
  type SmartTestSchedule,
} from "../services/smarttest.js";
import { asyncHandler } from "../util/errors.js";

export const storageRouter = Router();

// Device names are restricted to a safe charset before they reach smartctl.
const diskParam = z.string().regex(/^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/, "invalid disk name");

// md array names are restricted before they reach sysfs paths / unit names.
const arrayParam = z.string().regex(/^md\d+$/, "invalid array name");

const scrubScheduleSchema = z.object({
  frequency: z.enum(["disabled", "weekly", "monthly"]),
  weekday: z.number().int().min(0).max(6),
  day: z.number().int().min(1).max(28),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

const selfTestScheduleSchema = z.object({
  frequency: z.enum(["disabled", "weekly", "monthly"]),
  type: z.enum(["short", "long"]),
  weekday: z.number().int().min(0).max(6),
  day: z.number().int().min(1).max(28),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

const selfTestStartSchema = z.object({ type: z.enum(["short", "long"]) });

// GET /api/storage/disks
storageRouter.get(
  "/disks",
  asyncHandler(async (_req, res) => {
    res.json(await listBlockDevices());
  }),
);

// GET /api/storage/raid
storageRouter.get(
  "/raid",
  asyncHandler(async (_req, res) => {
    res.json(await listRaidArrays());
  }),
);

// GET /api/storage/zfs
storageRouter.get(
  "/zfs",
  asyncHandler(async (_req, res) => {
    res.json(await listZfsPools());
  }),
);

// GET /api/storage/smart/:disk
storageRouter.get(
  "/smart/:disk",
  asyncHandler(async (req, res) => {
    const disk = diskParam.parse(req.params.disk);
    res.json(await getSmart(disk));
  }),
);

// GET /api/storage/scrub
storageRouter.get(
  "/scrub",
  asyncHandler(async (_req, res) => {
    res.json(await getScrubStatus());
  }),
);

// PUT /api/storage/scrub/:array
storageRouter.put(
  "/scrub/:array",
  asyncHandler(async (req, res) => {
    const array = arrayParam.parse(req.params.array);
    const body: ScrubSchedule = scrubScheduleSchema.parse(req.body);
    res.json(await setScrubSchedule(array, body));
  }),
);

// POST /api/storage/scrub/:array/start
storageRouter.post(
  "/scrub/:array/start",
  asyncHandler(async (req, res) => {
    const array = arrayParam.parse(req.params.array);
    await startScrub(array);
    res.status(204).end();
  }),
);

// POST /api/storage/scrub/:array/cancel
storageRouter.post(
  "/scrub/:array/cancel",
  asyncHandler(async (req, res) => {
    const array = arrayParam.parse(req.params.array);
    await cancelScrub(array);
    res.status(204).end();
  }),
);

// GET /api/storage/selftest
storageRouter.get(
  "/selftest",
  asyncHandler(async (_req, res) => {
    res.json(await getSelfTestStatus());
  }),
);

// PUT /api/storage/selftest/:disk
storageRouter.put(
  "/selftest/:disk",
  asyncHandler(async (req, res) => {
    const disk = diskParam.parse(req.params.disk);
    const body: SmartTestSchedule = selfTestScheduleSchema.parse(req.body);
    res.json(await setSelfTestSchedule(disk, body));
  }),
);

// POST /api/storage/selftest/:disk/start
storageRouter.post(
  "/selftest/:disk/start",
  asyncHandler(async (req, res) => {
    const disk = diskParam.parse(req.params.disk);
    const body = selfTestStartSchema.parse(req.body);
    await startSelfTest(disk, body.type);
    res.status(204).end();
  }),
);

// POST /api/storage/selftest/:disk/cancel
storageRouter.post(
  "/selftest/:disk/cancel",
  asyncHandler(async (req, res) => {
    const disk = diskParam.parse(req.params.disk);
    await cancelSelfTest(disk);
    res.status(204).end();
  }),
);
