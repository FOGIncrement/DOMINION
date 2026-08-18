import { runTick } from "./simulation/engine.js";

const TICK_INTERVAL_MS = 60_000;

let running = false;

/**
 * Guards runTick() with a mutex so the background scheduler and any
 * cheat-forced tick (force-tick, simulate-offline) can never run
 * concurrently — without this, two overlapping ticks reading/writing the
 * same settlement rows would race, with whichever writes last silently
 * clobbering the other's result. Returns null if a tick was already in
 * progress and this call was skipped.
 */
export async function runTickSafely(): Promise<Awaited<ReturnType<typeof runTick>> | null> {
  if (running) return null;
  running = true;
  try {
    return await runTick();
  } finally {
    running = false;
  }
}

async function scheduledTick() {
  try {
    const result = await runTickSafely();
    if (result) {
      console.log(`[tick] processed ${result.settlementsProcessed} settlements, ${result.companiesProcessed} companies`);
    }
  } catch (err) {
    console.error("[tick] failed", err);
  }
}

export function startScheduler() {
  void scheduledTick(); // run once immediately on boot so the world doesn't feel stale
  setInterval(scheduledTick, TICK_INTERVAL_MS);
  console.log(`[scheduler] running every ${TICK_INTERVAL_MS / 1000}s`);
}
