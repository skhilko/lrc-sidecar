import type { AppConfig } from "../config/defaults.js";
import { APP_VERSION } from "../config/defaults.js";
import type { Logger } from "../domain/types.js";
import { openStateDatabaseReadOnly } from "../state/database.js";
import { StateRepository } from "../state/repository.js";

export async function runStatus(config: AppConfig, logger: Logger): Promise<void> {
  const state = await openStateDatabaseReadOnly(config.statePath);
  try {
    const summary = new StateRepository(state.database).status(Date.now());
    const next = summary.nextRetryAtMs === null ? "none" : new Date(summary.nextRetryAtMs).toISOString();
    logger.event({
      event: "status_summary", level: "info",
      message: `State: ${summary.total} track(s); counts ${JSON.stringify(summary.counts)}; retry eligible ${summary.retryEligible}; next retry ${next}`,
      ...summary, schemaVersion: state.schemaVersion, appVersion: APP_VERSION,
    });
    for (const download of summary.recentDownloads) logger.event({ event: "status_recent_download", level: "info", message: `Recent download: ${String(download.audio_path)}`, ...download });
    for (const error of summary.recentErrors) logger.event({ event: "status_recent_error", level: "warn", message: `Recent error: ${String(error.audio_path)} (${String(error.last_error_code)})`, ...error });
  } finally { state.close(); }
}
