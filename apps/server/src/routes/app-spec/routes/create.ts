/**
 * POST /create endpoint - Create project spec from overview
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
import { generateSpec } from "../generate-spec.js";

const logger = createLogger("SpecRegeneration");

export function createCreateHandler(events: EventEmitter) {
  return async (req: Request, res: Response): Promise<void> => {
    logger.info("========== /create endpoint called ==========");
    logger.debug("Request body:", JSON.stringify(req.body, null, 2));

    try {
      const { projectPath, projectOverview, generateFeatures, analyzeProject } =
        req.body as {
          projectPath: string;
          projectOverview: string;
          generateFeatures?: boolean;
          analyzeProject?: boolean;
        };

      logger.debug("Parsed params:");
      logger.debug("  projectPath:", projectPath);
      logger.debug(
        "  projectOverview length:",
        `${projectOverview?.length || 0} chars`
      );
      logger.debug("  generateFeatures:", generateFeatures);
      logger.debug("  analyzeProject:", analyzeProject);

      if (!projectPath || !projectOverview) {
        logger.error("Missing required parameters");
        res.status(400).json({
          success: false,
          error: "projectPath and projectOverview required",
        });
        return;
      }

      if (isRunning) {
        logger.warn("Generation already running, rejecting request");
        res.json({ success: false, error: "Spec generation already running" });
        return;
      }

      logAuthStatus("Before starting generation");

      const abortController = new AbortController();
      setRunningState(true, abortController);
      logger.info("Starting background generation task...");

      // Start generation in background
      generateSpec(
        projectPath,
        projectOverview,
        events,
        abortController,
        generateFeatures,
        analyzeProject
      )
        .catch((error) => {
          logError(error, "Generation failed with error");
          events.emit("spec-regeneration:event", {
            type: "spec_regeneration_error",
            error: getErrorMessage(error),
            projectPath: projectPath,
          });
        })
        .finally(() => {
          logger.info("Generation task finished (success or error)");
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
