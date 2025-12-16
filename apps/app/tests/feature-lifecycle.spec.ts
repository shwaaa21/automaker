/**
 * Feature Lifecycle End-to-End Tests
 *
 * Tests the complete feature lifecycle flow:
 * 1. Create a feature in backlog
 * 2. Drag to in_progress and wait for agent to finish
 * 3. Verify it moves to waiting_approval (manual review)
 * 4. Click commit and verify git status shows committed changes
 * 5. Drag to verified column
 * 6. Archive (complete) the feature
 * 7. Open archive modal and restore the feature
 * 8. Delete the feature
 *
 * NOTE: This test uses AUTOMAKER_MOCK_AGENT=true to mock the agent
 * so it doesn't make real API calls during CI/CD runs.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

import {
  waitForNetworkIdle,
  createTestGitRepo,
  cleanupTempDir,
  createTempDirPath,
  setupProjectWithPath,
  waitForBoardView,
  clickAddFeature,
  fillAddFeatureDialog,
  confirmAddFeature,
  dragAndDropWithDndKit,
} from "./utils";

const execAsync = promisify(exec);

// Create unique temp dir for this test run
const TEST_TEMP_DIR = createTempDirPath("feature-lifecycle-tests");

interface TestRepo {
  path: string;
  cleanup: () => Promise<void>;
}

// Configure all tests to run serially
test.describe.configure({ mode: "serial" });

test.describe("Feature Lifecycle Tests", () => {
  let testRepo: TestRepo;
  let featureId: string;

  test.beforeAll(async () => {
    // Create test temp directory
    if (!fs.existsSync(TEST_TEMP_DIR)) {
      fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
    }
  });

  test.beforeEach(async () => {
    // Create a fresh test repo for each test
    testRepo = await createTestGitRepo(TEST_TEMP_DIR);
  });

  test.afterEach(async () => {
    // Cleanup test repo after each test
    if (testRepo) {
      await testRepo.cleanup();
    }
  });

  test.afterAll(async () => {
    // Cleanup temp directory
    cleanupTempDir(TEST_TEMP_DIR);
  });

  test("complete feature lifecycle: create -> in_progress -> waiting_approval -> commit -> verified -> archive -> restore -> delete", async ({
    page,
  }) => {
    // Increase timeout for this comprehensive test
    test.setTimeout(120000);

    // ==========================================================================
    // Step 1: Setup and create a feature in backlog
    // ==========================================================================
    await setupProjectWithPath(page, testRepo.path);
    await page.goto("/");
    await waitForNetworkIdle(page);
    await waitForBoardView(page);

    // Wait a bit for the UI to fully load
    await page.waitForTimeout(1000);

    // Click add feature button
    await clickAddFeature(page);

    // Fill in the feature details - requesting a file with "yellow" content
    const featureDescription = "Create a file named yellow.txt that contains the text yellow";
    const descriptionInput = page.locator('[data-testid="add-feature-dialog"] textarea').first();
    await descriptionInput.fill(featureDescription);

    // Confirm the feature creation
    await confirmAddFeature(page);

    // Debug: Check the filesystem to see if feature was created
    const featuresDir = path.join(testRepo.path, ".automaker", "features");

    // Wait for the feature to be created in the filesystem
    await expect(async () => {
      const dirs = fs.readdirSync(featuresDir);
      expect(dirs.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10000 });

    // Reload to force features to load from filesystem
    await page.reload();
    await waitForNetworkIdle(page);
    await waitForBoardView(page);

    // Wait for the feature card to appear on the board
    const featureCard = page.getByText(featureDescription).first();
    await expect(featureCard).toBeVisible({ timeout: 15000 });

    // Get the feature ID from the filesystem
    const featureDirs = fs.readdirSync(featuresDir);
    featureId = featureDirs[0];

    // Now get the actual card element by testid
    const featureCardByTestId = page.locator(`[data-testid="kanban-card-${featureId}"]`);
    await expect(featureCardByTestId).toBeVisible({ timeout: 10000 });

    // ==========================================================================
    // Step 2: Drag feature to in_progress and wait for agent to finish
    // ==========================================================================
    const dragHandle = page.locator(`[data-testid="drag-handle-${featureId}"]`);
    const inProgressColumn = page.locator('[data-testid="kanban-column-in_progress"]');

    // Perform the drag and drop using dnd-kit compatible method
    await dragAndDropWithDndKit(page, dragHandle, inProgressColumn);

    // Wait for the feature to move to in_progress
    await page.waitForTimeout(500);

    // The mock agent should complete quickly (about 1.3 seconds based on the sleep times)
    // Wait for the feature to move to waiting_approval (manual review)
    // The status changes are: in_progress -> waiting_approval after agent completes
    await expect(async () => {
      const featureData = JSON.parse(
        fs.readFileSync(path.join(featuresDir, featureId, "feature.json"), "utf-8")
      );
      expect(featureData.status).toBe("waiting_approval");
    }).toPass({ timeout: 30000 });

    // Refresh page to ensure UI reflects the status change
    await page.reload();
    await waitForNetworkIdle(page);
    await waitForBoardView(page);

    // ==========================================================================
    // Step 3: Verify feature is in waiting_approval (manual review) column
    // ==========================================================================
    const waitingApprovalColumn = page.locator('[data-testid="kanban-column-waiting_approval"]');
    const cardInWaitingApproval = waitingApprovalColumn.locator(`[data-testid="kanban-card-${featureId}"]`);
    await expect(cardInWaitingApproval).toBeVisible({ timeout: 10000 });

    // Verify the mock agent created the yellow.txt file
    const yellowFilePath = path.join(testRepo.path, "yellow.txt");
    expect(fs.existsSync(yellowFilePath)).toBe(true);
    const yellowContent = fs.readFileSync(yellowFilePath, "utf-8");
    expect(yellowContent).toBe("yellow");

    // ==========================================================================
    // Step 4: Click commit and verify git status shows committed changes
    // ==========================================================================
    // The commit button should be visible on the card in waiting_approval
    const commitButton = page.locator(`[data-testid="commit-${featureId}"]`);
    await expect(commitButton).toBeVisible({ timeout: 5000 });
    await commitButton.click();

    // Wait for the commit to process
    await page.waitForTimeout(2000);

    // Verify git status shows clean (changes committed)
    const { stdout: gitStatus } = await execAsync("git status --porcelain", {
      cwd: testRepo.path,
    });
    // After commit, the yellow.txt file should be committed, so git status should be clean
    // (only .automaker directory might have changes)
    expect(gitStatus.includes("yellow.txt")).toBe(false);

    // Verify the commit exists in git log
    const { stdout: gitLog } = await execAsync("git log --oneline -1", {
      cwd: testRepo.path,
    });
    expect(gitLog.toLowerCase()).toContain("yellow");

    // ==========================================================================
    // Step 5: Verify feature moved to verified column after commit
    // ==========================================================================
    // Feature should automatically move to verified after commit
    await page.reload();
    await waitForNetworkIdle(page);
    await waitForBoardView(page);

    const verifiedColumn = page.locator('[data-testid="kanban-column-verified"]');
    const cardInVerified = verifiedColumn.locator(`[data-testid="kanban-card-${featureId}"]`);
    await expect(cardInVerified).toBeVisible({ timeout: 10000 });

    // ==========================================================================
    // Step 6: Archive (complete) the feature
    // ==========================================================================
    // Click the Complete button on the verified card
    const completeButton = page.locator(`[data-testid="complete-${featureId}"]`);
    await expect(completeButton).toBeVisible({ timeout: 5000 });
    await completeButton.click();

    // Wait for the archive action to complete
    await page.waitForTimeout(1000);

    // Verify the feature is no longer visible on the board (it's archived)
    await expect(cardInVerified).not.toBeVisible({ timeout: 5000 });

    // Verify feature status is completed in filesystem
    const featureData = JSON.parse(
      fs.readFileSync(path.join(featuresDir, featureId, "feature.json"), "utf-8")
    );
    expect(featureData.status).toBe("completed");

    // ==========================================================================
    // Step 7: Open archive modal and restore the feature
    // ==========================================================================
    // Click the completed features button to open the archive modal
    const completedFeaturesButton = page.locator('[data-testid="completed-features-button"]');
    await expect(completedFeaturesButton).toBeVisible({ timeout: 5000 });
    await completedFeaturesButton.click();

    // Wait for the modal to open
    const completedModal = page.locator('[data-testid="completed-features-modal"]');
    await expect(completedModal).toBeVisible({ timeout: 5000 });

    // Verify the archived feature is shown in the modal
    const archivedCard = completedModal.locator(`[data-testid="completed-card-${featureId}"]`);
    await expect(archivedCard).toBeVisible({ timeout: 5000 });

    // Click the restore button
    const restoreButton = page.locator(`[data-testid="unarchive-${featureId}"]`);
    await expect(restoreButton).toBeVisible({ timeout: 5000 });
    await restoreButton.click();

    // Wait for the restore action to complete
    await page.waitForTimeout(1000);

    // Close the modal
    const closeButton = completedModal.locator('button:has-text("Close")');
    await closeButton.click();
    await expect(completedModal).not.toBeVisible({ timeout: 5000 });

    // Verify the feature is back in the verified column
    const restoredCard = verifiedColumn.locator(`[data-testid="kanban-card-${featureId}"]`);
    await expect(restoredCard).toBeVisible({ timeout: 10000 });

    // Verify feature status is verified in filesystem
    const restoredFeatureData = JSON.parse(
      fs.readFileSync(path.join(featuresDir, featureId, "feature.json"), "utf-8")
    );
    expect(restoredFeatureData.status).toBe("verified");

    // ==========================================================================
    // Step 8: Delete the feature and verify it's removed
    // ==========================================================================
    // Click the delete button on the verified card
    const deleteButton = page.locator(`[data-testid="delete-verified-${featureId}"]`);
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();

    // Wait for the confirmation dialog
    const confirmDialog = page.locator('[data-testid="delete-confirmation-dialog"]');
    await expect(confirmDialog).toBeVisible({ timeout: 5000 });

    // Click the confirm delete button
    const confirmDeleteButton = page.locator('[data-testid="confirm-delete-button"]');
    await confirmDeleteButton.click();

    // Wait for the delete action to complete
    await page.waitForTimeout(1000);

    // Verify the feature is no longer visible on the board
    await expect(restoredCard).not.toBeVisible({ timeout: 5000 });

    // Verify the feature directory is deleted from filesystem
    const featureDirExists = fs.existsSync(path.join(featuresDir, featureId));
    expect(featureDirExists).toBe(false);
  });
});
