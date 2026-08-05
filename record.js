const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

async function ensureDir(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (e) {
    // ignore
  }
}

async function findAnyVideoFiles(dir = "videos") {
  try {
    const found = [];
    async function walk(d) {
      const entries = await fs.promises.readdir(d, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          await walk(full);
        } else if (/\.(webm|mp4|mkv)$/i.test(ent.name)) {
          found.push(full);
        }
      }
    }
    await walk(dir);
    return found;
  } catch (err) {
    return [];
  }
}

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
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Try to create a context with video recording; fallback if it fails
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: "videos/",
        size: { width: 1280, height: 720 },
      },
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).toLowerCase();
    if (msg.includes("ffmpeg") || msg.includes("video") || msg.includes("record")) {
      console.warn("RecordVideo failed (ffmpeg or recording not available). Falling back to context without video.");
      context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    } else {
      console.error("Failed to create browser context:", err);
      await browser.close();
      process.exit(1);
    }
  }

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
  } catch (err) {
    console.error(`Failed to load ${url}:`, err && err.message ? err.message : err);
    // continue to attempt interactions
  }

  // Small pause so the loaded page is visible before scrolling
  await page.waitForTimeout(1500);

  // Scroll down a little, like a real visitor glancing at the page
  await page.mouse.wheel(0, 400);

  // --- Try to find & check the "I agree" checkbox after scrolling ---
  try {
    await page.waitForTimeout(500); // allow lazy content to appear

    // 1) Accessible checkbox by role
    if (page.getByRole) {
      const agree = page.getByRole('checkbox', { name: /I agree/i }).first();
      await agree.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
      await agree.check({ timeout: 3000 }).catch(() => {});
      console.log("Checked 'I agree' checkbox (by role).");
    } else {
      // fallback: click first checkbox input or label
      const label = page.locator('text=/I agree to the|I agree/i').first();
      if ((await label.count()) > 0) {
        await label.click({ timeout: 3000 });
        console.log("Clicked label containing 'I agree' to toggle checkbox.");
      } else {
        const firstCheckbox = page.locator('input[type=\"checkbox\"]').first();
        await firstCheckbox.waitFor({ state: 'visible', timeout: 2000 });
        await firstCheckbox.check({ timeout: 2000 });
        console.log("Checked the first input[type=checkbox] on the page.");
      }
    }
  } catch (e) {
    console.warn("Failed to check the 'I agree' checkbox (continuing):", e && e.message ? e.message : e);
  }

  // Wait the specified time to record/observe
  await page.waitForTimeout(duration * 1000);

  // Attempt to capture a Brave-session screenshot and HTML as an additional artifact (best-effort)
  try {
    await ensureDir("screenshots");
    await ensureDir("artifacts");
    const timestamp = Date.now();
    const screenshotPath = path.join("screenshots", `screenshot-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const htmlContent = await page.content().catch(() => "<html><body>no-html-captured</body></html>");
    const htmlPath = `page-${timestamp}.html`;
    await fs.promises.writeFile(path.join("artifacts", htmlPath), htmlContent, "utf8");
    // marker
    await fs.promises.writeFile(path.join("artifacts", "capture-marker.txt"), `screenshot:${screenshotPath}\nhtml:${htmlPath}\n`, "utf8");
    console.log("Saved session screenshot and page HTML as fallback artifacts.");
  } catch (e) {
    console.warn("Failed to capture screenshot/HTML (non-fatal):", e && e.message ? e.message : e);
  }

  // Close context (this finalizes video files when available) and browser
  await context.close();
  await browser.close();

  // After browser closed, check whether any video files were produced.
  const videoFiles = await findAnyVideoFiles("videos");
  if (videoFiles.length > 0) {
    console.log("Video files produced:");
    for (const f of videoFiles) console.log(" -", f);
    console.log("Done. Video saved in videos/ directory.");
    process.exit(0);
  }

  console.log("No video files found. Fallback artifacts (screenshots/html) saved under screenshots/ and artifacts/.");
  process.exit(0);
})();
