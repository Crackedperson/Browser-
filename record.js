const { chromium } = require("playwright");

(async () => {
  const url = process.env.TARGET_URL;
  const duration = parseInt(process.env.DURATION_SECONDS || "10", 10);
  const bravePath = process.env.BRAVE_PATH || "/usr/bin/brave-browser";

  if (!url) {
    console.error("TARGET_URL env var is required");
    process.exit(1);
  }

  console.log(`Launching Brave at ${bravePath}, visiting ${url} for ${duration}s...`);

  const browser = await chromium.launch({
    executablePath: bravePath,
    headless: false, // visible browser (needs xvfb-run on CI)
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // Add other flags as needed:
      // "--disable-dev-shm-usage",
      // "--disable-extensions",
    ],
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
    console.error(`Failed to load ${url}:`, err && err.message ? err.message : err);
    // decide whether to exit here; currently continues to attempt interactions
  }

  // Small pause so the loaded page is visible before scrolling
  await page.waitForTimeout(1500);

  // Scroll down a little, like a real visitor glancing at the page
  await page.mouse.wheel(0, 400);

  // --- Try to find & check the "I agree" checkbox after scrolling ---
  try {
    await page.waitForTimeout(500); // allow lazy content to appear

    const agree = page.getByRole?.('checkbox' , { name: /I agree/i }) || page.locator('input[type="checkbox"]');
    // If getByRole exists (Playwright >=1.25), use it; otherwise fallback to locator above
    if (agree && agree.check) {
      await agree.first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      await agree.first().check({ timeout: 3000 });
      console.log("Checked 'I agree' checkbox (by role/locator).");
    } else {
      // fallback click on text label
      const label = page.locator('text=/I agree to the|I agree/i').first();
      if ((await label.count()) > 0) {
        await label.click({ timeout: 3000 });
        console.log("Clicked label containing 'I agree' to toggle checkbox.");
      } else {
        const firstCheckbox = page.locator('input[type="checkbox"]').first();
        await firstCheckbox.waitFor({ state: 'visible', timeout: 2000 });
        await firstCheckbox.check({ timeout: 2000 });
        console.log("Checked the first input[type=checkbox] on the page.");
      }
    }
  } catch (e) {
    console.error("Failed to check the 'I agree' checkbox:", e && e.message ? e.message : e);
    // If you want the workflow to fail when the checkbox can't be checked, uncomment next line:
    // process.exit(1);
  }
  // --- end inserted code ---

  await page.waitForTimeout(duration * 1000);

  // Closing the context finalizes and writes the .webm video file
  await context.close();
  await browser.close();

  console.log("Done. Video saved in videos/ directory (look for videos/**/video.webm).");
})();
