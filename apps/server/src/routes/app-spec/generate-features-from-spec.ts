/**
 * Generate features from existing app_spec.txt
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import fs from "fs/promises";
import type { EventEmitter } from "../../lib/events.js";
import { createLogger } from "../../lib/logger.js";
import { logAuthStatus } from "./common.js";
import { parseAndCreateFeatures } from "./parse-and-create-features.js";

const logger = createLogger("SpecRegeneration");

export async function generateFeaturesFromSpec(
  projectPath: string,
  events: EventEmitter,
  abortController: AbortController
): Promise<void> {
  logger.debug("========== generateFeaturesFromSpec() started ==========");
  logger.debug("projectPath:", projectPath);

  // Read existing spec
  const specPath = path.join(projectPath, ".automaker", "app_spec.txt");
  let spec: string;

  logger.debug("Reading spec from:", specPath);

  try {
    spec = await fs.readFile(specPath, "utf-8");
    logger.info(`Spec loaded successfully (${spec.length} chars)`);
  } catch (readError) {
    logger.error("❌ Failed to read spec file:", readError);
    events.emit("spec-regeneration:event", {
      type: "spec_regeneration_error",
      error: "No project spec found. Generate spec first.",
      projectPath: projectPath,
    });
    return;
  }

  const prompt = `Based on this project specification:

${spec}

Generate a prioritized list of implementable features. For each feature provide:

1. **id**: A unique lowercase-hyphenated identifier
2. **title**: Short descriptive title
3. **description**: What this feature does (2-3 sentences)
4. **priority**: 1 (high), 2 (medium), or 3 (low)
5. **complexity**: "simple", "moderate", or "complex"
6. **dependencies**: Array of feature IDs this depends on (can be empty)

Format as JSON:
{
  "features": [
    {
      "id": "feature-id",
      "title": "Feature Title",
      "description": "What it does",
      "priority": 1,
      "complexity": "moderate",
      "dependencies": []
    }
  ]
}

Generate 5-15 features that build on each other logically.`;

  logger.debug("Prompt length:", `${prompt.length} chars`);

  events.emit("spec-regeneration:event", {
    type: "spec_regeneration_progress",
    content: "Analyzing spec and generating features...\n",
    projectPath: projectPath,
  });

  const options: Options = {
    model: "claude-sonnet-4-20250514",
    maxTurns: 5,
    cwd: projectPath,
    allowedTools: ["Read", "Glob"],
    permissionMode: "acceptEdits",
    abortController,
  };

  logger.debug("SDK Options:", JSON.stringify(options, null, 2));
  logger.info("Calling Claude Agent SDK query() for features...");

  logAuthStatus("Right before SDK query() for features");

  let stream;
  try {
    stream = query({ prompt, options });
    logger.debug("query() returned stream successfully");
  } catch (queryError) {
    logger.error("❌ query() threw an exception:");
    logger.error("Error:", queryError);
    throw queryError;
  }

  let responseText = "";
  let messageCount = 0;

  logger.debug("Starting to iterate over feature stream...");

  try {
    for await (const msg of stream) {
      messageCount++;
      logger.debug(
        `Feature stream message #${messageCount}:`,
        JSON.stringify(
          { type: msg.type, subtype: (msg as any).subtype },
          null,
          2
        )
      );

      if (msg.type === "assistant" && msg.message.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            responseText = block.text;
            logger.debug(
              `Feature text block received (${block.text.length} chars)`
            );
            events.emit("spec-regeneration:event", {
              type: "spec_regeneration_progress",
              content: block.text,
              projectPath: projectPath,
            });
          }
        }
      } else if (msg.type === "result" && (msg as any).subtype === "success") {
        logger.debug("Received success result for features");
        responseText = (msg as any).result || responseText;
      } else if ((msg as { type: string }).type === "error") {
        logger.error("❌ Received error message from feature stream:");
        logger.error("Error message:", JSON.stringify(msg, null, 2));
      }
    }
  } catch (streamError) {
    logger.error("❌ Error while iterating feature stream:");
    logger.error("Stream error:", streamError);
    throw streamError;
  }

  logger.info(`Feature stream complete. Total messages: ${messageCount}`);
  logger.info(`Feature response length: ${responseText.length} chars`);

  await parseAndCreateFeatures(projectPath, responseText, events);

  logger.debug("========== generateFeaturesFromSpec() completed ==========");
}
