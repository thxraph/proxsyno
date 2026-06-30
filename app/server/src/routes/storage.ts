/**
 * Read-only storage routes: disks, md RAID, ZFS pools, and SMART per disk.
 */
import { Router } from "express";
import { z } from "zod";
import { getSmart, listBlockDevices, listRaidArrays, listZfsPools } from "../services/storage.js";
import { asyncHandler } from "../util/errors.js";

export const storageRouter = Router();

// Device names are restricted to a safe charset before they reach smartctl.
const diskParam = z.string().regex(/^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/, "invalid disk name");

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
