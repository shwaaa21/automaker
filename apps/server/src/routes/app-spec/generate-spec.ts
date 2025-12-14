/**
 * Generate app_spec.txt from project overview
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import fs from "fs/promises";
import type { EventEmitter } from "../../lib/events.js";
import { getAppSpecFormatInstruction } from "../../lib/app-spec-format.js";
import { createLogger } from "../../lib/logger.js";
import { logAuthStatus } from "./common.js";
import { generateFeaturesFromSpec } from "./generate-features-from-spec.js";

const logger = createLogger("SpecRegeneration");

export async function generateSpec(
  projectPath: string,
  projectOverview: string,
  events: EventEmitter,
  abortController: AbortController,
  generateFeatures?: boolean,
  analyzeProject?: boolean
): Promise<void> {
  logger.debug("========== generateSpec() started ==========");
  logger.debug("projectPath:", projectPath);
  logger.debug("projectOverview length:", `${projectOverview.length} chars`);
  logger.debug("generateFeatures:", generateFeatures);
  logger.debug("analyzeProject:", analyzeProject);

  // Build the prompt based on whether we should analyze the project
  let analysisInstructions = "";
  let techStackDefaults = "";

  if (analyzeProject !== false) {
    // Default to true - analyze the project
    analysisInstructions = `Based on this overview, analyze the project directory (if it exists) and create a comprehensive specification. Use the Read, Glob, and Grep tools to explore the codebase and understand:
- Existing technologies and frameworks
- Project structure and architecture
- Current features and capabilities
- Code patterns and conventions`;
  } else {
    // Use default tech stack
    techStackDefaults = `Default Technology Stack:
- Framework: TanStack Start (React-based full-stack framework)
- Database: PostgreSQL with Drizzle ORM
- UI Components: shadcn/ui
- Styling: Tailwind CSS
- Frontend: React

Use these technologies as the foundation for the specification.`;
  }

  const prompt = `You are helping to define a software project specification.

IMPORTANT: Never ask for clarification or additional information. Use the information provided and make reasonable assumptions to create the best possible specification. If details are missing, infer them based on common patterns and best practices.

Project Overview:
${projectOverview}

${techStackDefaults}

${analysisInstructions}

${getAppSpecFormatInstruction()}`;

  logger.debug("Prompt length:", `${prompt.length} chars`);

  events.emit("spec-regeneration:event", {
    type: "spec_progress",
    content: "Starting spec generation...\n",
  });

  const options: Options = {
    model: "claude-opus-4-5-20251101",
    maxTurns: 10,
    cwd: projectPath,
    allowedTools: ["Read", "Glob", "Grep"],
    permissionMode: "acceptEdits",
    abortController,
  };

  logger.debug("SDK Options:", JSON.stringify(options, null, 2));
  logger.info("Calling Claude Agent SDK query()...");

  // Log auth status right before the SDK call
  logAuthStatus("Right before SDK query()");

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

  logger.debug("Starting to iterate over stream...");

  try {
    for await (const msg of stream) {
      messageCount++;
      logger.debug(
        `Stream message #${messageCount}:`,
        JSON.stringify(
          { type: msg.type, subtype: (msg as any).subtype },
          null,
          2
        )
      );

      if (msg.type === "assistant" && msg.message.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            responseText += block.text;
            logger.debug(`Text block received (${block.text.length} chars)`);
            events.emit("spec-regeneration:event", {
              type: "spec_regeneration_progress",
              content: block.text,
              projectPath: projectPath,
            });
          } else if (block.type === "tool_use") {
            logger.debug("Tool use:", block.name);
            events.emit("spec-regeneration:event", {
              type: "spec_tool",
              tool: block.name,
              input: block.input,
            });
          }
        }
      } else if (msg.type === "result" && (msg as any).subtype === "success") {
        logger.debug("Received success result");
        responseText = (msg as any).result || responseText;
      } else if ((msg as { type: string }).type === "error") {
        logger.error("❌ Received error message from stream:");
        logger.error("Error message:", JSON.stringify(msg, null, 2));
      }
    }
  } catch (streamError) {
    logger.error("❌ Error while iterating stream:");
    logger.error("Stream error:", streamError);
    throw streamError;
  }

  logger.info(`Stream iteration complete. Total messages: ${messageCount}`);
  logger.info(`Response text length: ${responseText.length} chars`);

  // Save spec
  const specDir = path.join(projectPath, ".automaker");
  const specPath = path.join(specDir, "app_spec.txt");

  logger.info("Saving spec to:", specPath);

  await fs.mkdir(specDir, { recursive: true });
  await fs.writeFile(specPath, responseText);

  logger.info("Spec saved successfully");

  // Emit spec completion event
  if (generateFeatures) {
    // If features will be generated, emit intermediate completion
    events.emit("spec-regeneration:event", {
      type: "spec_regeneration_progress",
      content: "[Phase: spec_complete] Spec created! Generating features...\n",
      projectPath: projectPath,
    });
  } else {
    // If no features, emit final completion
    events.emit("spec-regeneration:event", {
      type: "spec_regeneration_complete",
      message: "Spec regeneration complete!",
      projectPath: projectPath,
    });
  }

  // If generate features was requested, generate them from the spec
  if (generateFeatures) {
    logger.info("Starting feature generation from spec...");
    // Create a new abort controller for feature generation
    const featureAbortController = new AbortController();
    try {
      await generateFeaturesFromSpec(
        projectPath,
        events,
        featureAbortController
      );
      // Final completion will be emitted by generateFeaturesFromSpec -> parseAndCreateFeatures
    } catch (featureError) {
      logger.error("Feature generation failed:", featureError);
      // Don't throw - spec generation succeeded, feature generation is optional
      events.emit("spec-regeneration:event", {
        type: "spec_regeneration_error",
        error: (featureError as Error).message || "Feature generation failed",
        projectPath: projectPath,
      });
    }
  }

  logger.debug("========== generateSpec() completed ==========");
}
