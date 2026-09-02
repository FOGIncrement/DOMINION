import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/index.js";
import { requireAdmin } from "../auth/requireAdmin.js";
import {
  getConfig,
  getConfigRegistryMeta,
  resetAll,
  resetFlatGroup,
  resetRecordEntry,
  setFlatOverrides,
  setRecordOverrides,
} from "../gameConfigStore.js";

// Deliberately its own router, gated by requireAuth + requireAdmin only —
// NOT the ENABLE_CHEATS env kill-switch the disposable cheatsRouter uses.
// This is a standing tuning tool, not a disposable cheat; it shouldn't go
// dark just because that flag is ever off.
export const adminConfigRouter = Router();
adminConfigRouter.use(requireAuth, requireAdmin);

adminConfigRouter.get("/", (_req, res) => {
  res.json({ config: getConfig(), meta: getConfigRegistryMeta() });
});

const numericPatchSchema = z.record(z.string(), z.number());

adminConfigRouter.post("/flat/:group", async (req, res) => {
  const parsed = numericPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  try {
    const config = await setFlatOverrides(req.params.group as never, parsed.data);
    res.json({ ok: true, config });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to set overrides" });
  }
});

adminConfigRouter.post("/flat/:group/reset", async (req, res) => {
  try {
    const config = await resetFlatGroup(req.params.group as never);
    res.json({ ok: true, config });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to reset group" });
  }
});

const recordGroupSchema = z.enum(["COMPANY_INDUSTRIES"]);

adminConfigRouter.post("/record/:group/:entryId", async (req, res) => {
  const groupParsed = recordGroupSchema.safeParse(req.params.group);
  const patchParsed = numericPatchSchema.safeParse(req.body);
  if (!groupParsed.success || !patchParsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  try {
    const config = await setRecordOverrides(groupParsed.data, req.params.entryId, patchParsed.data);
    res.json({ ok: true, config });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to set overrides" });
  }
});

adminConfigRouter.post("/record/:group/:entryId/reset", async (req, res) => {
  const groupParsed = recordGroupSchema.safeParse(req.params.group);
  if (!groupParsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const config = await resetRecordEntry(groupParsed.data, req.params.entryId);
  res.json({ ok: true, config });
});

adminConfigRouter.post("/reset-all", async (_req, res) => {
  const config = await resetAll();
  res.json({ ok: true, config });
});
