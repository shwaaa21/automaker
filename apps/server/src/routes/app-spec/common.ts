/**
 * Common utilities and state management for spec regeneration
 */

import { createLogger } from "../../lib/logger.js";

const logger = createLogger("SpecRegeneration");

// Shared state for tracking generation status
export let isRunning = false;
export let currentAbortController: AbortController | null = null;

/**
 * Set the running state and abort controller
 */
export function setRunningState(
  running: boolean,
  controller: AbortController | null = null
): void {
  isRunning = running;
  currentAbortController = controller;
}

/**
 * Helper to log authentication status
 */
export function logAuthStatus(context: string): void {
  const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  logger.info(`${context} - Auth Status:`);
  logger.info(
    `  CLAUDE_CODE_OAUTH_TOKEN: ${
      hasOAuthToken
        ? "SET (" +
          process.env.CLAUDE_CODE_OAUTH_TOKEN?.substring(0, 20) +
          "...)"
        : "NOT SET"
    }`
  );
  logger.info(
    `  ANTHROPIC_API_KEY: ${
      hasApiKey
        ? "SET (" + process.env.ANTHROPIC_API_KEY?.substring(0, 20) + "...)"
        : "NOT SET"
    }`
  );

  if (!hasOAuthToken && !hasApiKey) {
    logger.warn("⚠️  WARNING: No authentication configured! SDK will fail.");
  }
}

/**
 * Log error details consistently
 */
export function logError(error: unknown, context: string): void {
  logger.error(`❌ ${context}:`);
  logger.error("Error name:", (error as any)?.name);
  logger.error("Error message:", (error as Error)?.message);
  logger.error("Error stack:", (error as Error)?.stack);
  logger.error(
    "Full error object:",
    JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
  );
}

/**
 * Get error message from error object
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
