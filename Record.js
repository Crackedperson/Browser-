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

  await page.waitForTimeout(duration * 1000);

  // Closing the context finalizes and writes the .webm video file
  await context.close();
  await browser.close();

  console.log("Done. Video saved in videos/ directory.");
})();
