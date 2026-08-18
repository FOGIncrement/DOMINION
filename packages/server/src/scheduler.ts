import { runTick } from "./simulation/engine.js";

const TICK_INTERVAL_MS = 60_000;

let running = false;

async function tick() {
  if (running) return; // skip overlapping runs if a tick takes longer than the interval
  running = true;
  try {
    const result = await runTick();
    console.log(`[tick] processed ${result.settlementsProcessed} settlements, ${result.companiesProcessed} companies`);
  } catch (err) {
    console.error("[tick] failed", err);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  void tick(); // run once immediately on boot so the world doesn't feel stale
  setInterval(tick, TICK_INTERVAL_MS);
  console.log(`[scheduler] running every ${TICK_INTERVAL_MS / 1000}s`);
}
