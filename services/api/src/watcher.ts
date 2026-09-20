import type { FastifyBaseLogger } from "fastify";
import { getErrorRate } from "./remediation.js";
import { hasOpenIncident } from "./incidentStore.js";
import { investigateAndNotify } from "./incidentPipeline.js";

const MONITORED_CONTAINER_NAME =
  process.env.MONITORED_CONTAINER_NAME ?? "ai_incident-demo-app-1";
const CHECK_INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS) || 30_000;
const ERROR_RATE_THRESHOLD = Number(process.env.WATCH_ERROR_RATE_THRESHOLD) || 0.1;
const LOOKBACK_MINUTES = Number(process.env.WATCH_LOOKBACK_MINUTES) || 2;

let checking = false;

/**
 * One check: query the current error rate and, if it's over threshold and
 * nothing is already awaiting a human decision, kick off an investigation.
 * Exported separately from the interval loop so it can be tested/run
 * directly rather than only inside a setInterval callback.
 */
export async function checkOnce(logger: Pick<FastifyBaseLogger, "info" | "warn" | "error">) {
  if (checking) return;
  if (hasOpenIncident()) return;

  checking = true;
  try {
    const rate = await getErrorRate(MONITORED_CONTAINER_NAME, LOOKBACK_MINUTES);
    if (rate > ERROR_RATE_THRESHOLD) {
      logger.warn(
        { rate, container: MONITORED_CONTAINER_NAME },
        "Error rate threshold breached, triggering investigation"
      );
      await investigateAndNotify(
        `Error rate on ${MONITORED_CONTAINER_NAME} is ${Math.round(rate * 100)}% ` +
          `over the last ${LOOKBACK_MINUTES} minutes`
      );
    }
  } catch (err) {
    logger.error({ err }, "Watcher check failed");
  } finally {
    checking = false;
  }
}

export function startWatcher(logger: FastifyBaseLogger) {
  logger.info(
    { intervalMs: CHECK_INTERVAL_MS, threshold: ERROR_RATE_THRESHOLD, container: MONITORED_CONTAINER_NAME },
    "Starting incident watcher"
  );
  setInterval(() => checkOnce(logger), CHECK_INTERVAL_MS);
}
