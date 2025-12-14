/**
 * Parse agent response and create feature files
 */

import path from "path";
import fs from "fs/promises";
import type { EventEmitter } from "../../lib/events.js";
import { createLogger } from "../../lib/logger.js";

const logger = createLogger("SpecRegeneration");

export async function parseAndCreateFeatures(
  projectPath: string,
  content: string,
  events: EventEmitter
): Promise<void> {
  logger.debug("========== parseAndCreateFeatures() started ==========");
  logger.debug("Content length:", `${content.length} chars`);

  try {
    // Extract JSON from response
    logger.debug("Extracting JSON from response...");
    const jsonMatch = content.match(/\{[\s\S]*"features"[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error("❌ No valid JSON found in response");
      logger.error("Content preview:", content.substring(0, 500));
      throw new Error("No valid JSON found in response");
    }

    logger.debug(`JSON match found (${jsonMatch[0].length} chars)`);

    const parsed = JSON.parse(jsonMatch[0]);
    logger.info(`Parsed ${parsed.features?.length || 0} features`);

    const featuresDir = path.join(projectPath, ".automaker", "features");
    await fs.mkdir(featuresDir, { recursive: true });

    const createdFeatures: Array<{ id: string; title: string }> = [];

    for (const feature of parsed.features) {
      logger.debug("Creating feature:", feature.id);
      const featureDir = path.join(featuresDir, feature.id);
      await fs.mkdir(featureDir, { recursive: true });

      const featureData = {
        id: feature.id,
        title: feature.title,
        description: feature.description,
        status: "backlog", // Features go to backlog - user must manually start them
        priority: feature.priority || 2,
        complexity: feature.complexity || "moderate",
        dependencies: feature.dependencies || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await fs.writeFile(
        path.join(featureDir, "feature.json"),
        JSON.stringify(featureData, null, 2)
      );

      createdFeatures.push({ id: feature.id, title: feature.title });
    }

    logger.info(`✓ Created ${createdFeatures.length} features successfully`);

    events.emit("spec-regeneration:event", {
      type: "spec_regeneration_complete",
      message: `Spec regeneration complete! Created ${createdFeatures.length} features.`,
      projectPath: projectPath,
    });
  } catch (error) {
    logger.error("❌ parseAndCreateFeatures() failed:");
    logger.error("Error:", error);
    events.emit("spec-regeneration:event", {
      type: "spec_regeneration_error",
      error: (error as Error).message,
      projectPath: projectPath,
    });
  }

  logger.debug("========== parseAndCreateFeatures() completed ==========");
}
