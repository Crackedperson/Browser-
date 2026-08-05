const { chromium } = require("playwright");

(async () => {
  const url = process.env.TARGET_URL;
  const duration = parseInt(process.env.DURATION_SECONDS || "10", 10);

  if (!url) {
    console.error("TARGET_URL env var is required");
    process.exit(1);
  }

  console.log(`Launching real Chrome, visiting ${url} for ${duration}s...`);

  const browser = await chromium.launch({
    channel: "chrome", // use real installed Chrome, not bundled Chromium
    headless: false, // runs on the virtual display provided by xvfb-run
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: "videos/",
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
  } catch (err) {
    console.error(`Failed to load ${url}:`, err.message);
  }

  // Small pause so the loaded page is visible before scrolling
  await page.waitForTimeout(1500);

  // Scroll down a little, like a real visitor glancing at the page
  await page.mouse.wheel(0, 400);

  // --- INSERTED: try to find & check the "I agree" checkbox after scrolling ---
  try {
    // Give dynamic content a short moment to appear (if the checkbox loads lazily)
    await page.waitForTimeout(500);

    // 1) Best: accessible role + name (robust when label text is exposed)
    const agree = page.getByRole('checkbox', { name: /I agree/i }).first();
    // wait for it to be visible (short timeout so it doesn't stall)
    await agree.waitFor({ state: 'visible', timeout: 3000 });
    await agree.check({ timeout: 3000 });
    console.log("Checked 'I agree' checkbox (by role).");
  } catch (e1) {
    console.warn("Role-based checkbox selector failed:", e1 && e1.message ? e1.message : e1);

    try {
      // 2) Fallback: click a label that contains the text (works if label wraps input or toggles it)
      const label = page.locator('text=/I agree to the|I agree/i').first();
      if (await label.count() > 0) {
        await label.click({ timeout: 3000 });
        console.log("Clicked label containing 'I agree' to toggle checkbox.");
      } else {
        // 3) Final fallback: check the first checkbox input on the page
        const firstCheckbox = page.locator('input[type="checkbox"]').first();
        await firstCheckbox.waitFor({ state: 'visible', timeout: 2000 });
        await firstCheckbox.check({ timeout: 2000 });
        console.log("Checked the first input[type=checkbox] on the page.");
      }
    } catch (e2) {
      console.error("Failed to check the 'I agree' checkbox:", e2 && e2.message ? e2.message : e2);
      // If you want the workflow to fail when the checkbox can't be checked, uncomment next line:
      // process.exit(1);
    }
  }
  // --- end inserted code ---

  await page.waitForTimeout(duration * 1000);

  // Closing the context finalizes and writes the .webm video file
  await context.close();
  await browser.close();

  console.log("Done. Video saved in videos/ directory.");
})();
