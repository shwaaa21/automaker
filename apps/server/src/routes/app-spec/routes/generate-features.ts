/**
 * POST /generate-features endpoint - Generate features from existing spec
 */

import type { Request, Response } from "express";
import type { EventEmitter } from "../../../lib/events.js";
import { createLogger } from "../../../lib/logger.js";
import {
  isRunning,
  setRunningState,
  logAuthStatus,
  logError,
  getErrorMessage,
} from "../common.js";
import { generateFeaturesFromSpec } from "../generate-features-from-spec.js";

const logger = createLogger("SpecRegeneration");

export function createGenerateFeaturesHandler(events: EventEmitter) {
  return async (req: Request, res: Response): Promise<void> => {
    logger.info("========== /generate-features endpoint called ==========");
    logger.debug("Request body:", JSON.stringify(req.body, null, 2));

    try {
      const { projectPath } = req.body as { projectPath: string };

      logger.debug("projectPath:", projectPath);

      if (!projectPath) {
        logger.error("Missing projectPath parameter");
        res.status(400).json({ success: false, error: "projectPath required" });
        return;
      }

      if (isRunning) {
        logger.warn("Generation already running, rejecting request");
        res.json({ success: false, error: "Generation already running" });
        return;
      }

      logAuthStatus("Before starting feature generation");

      const abortController = new AbortController();
      setRunningState(true, abortController);
      logger.info("Starting background feature generation task...");

      generateFeaturesFromSpec(projectPath, events, abortController)
        .catch((error) => {
          logError(error, "Feature generation failed with error");
          events.emit("spec-regeneration:event", {
            type: "features_error",
            error: getErrorMessage(error),
          });
        })
        .finally(() => {
          logger.info("Feature generation task finished (success or error)");
          setRunningState(false, null);
        });

      logger.info(
        "Returning success response (generation running in background)"
      );
      res.json({ success: true });
    } catch (error) {
      logger.error("❌ Route handler exception:");
      logger.error("Error:", error);
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
