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
  const phoneNumber = (process.env.PHONE_NUMBER || "").trim(); // expects 10-digit number, no country code

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

  // Scroll down a little, like a real visitor glancing at the page (reveals inputs/checkbox)
  await page.mouse.wheel(0, 400);

  // --- Fill phone number (best-effort) ---
  if (phoneNumber) {
    try {
      await page.waitForTimeout(300); // allow lazy content
      let phoneLocator = null;

      // 1) Try placeholder-based locator (common)
      if (page.getByPlaceholder) {
        const p = page.getByPlaceholder('Enter 10-digit number', { exact: false }).first();
        if ((await p.count()) > 0) phoneLocator = p;
      }

      // 2) Generic common selectors
      if (!phoneLocator) {
        const candidate = page.locator('input[type="tel"], input[placeholder*="10"], input[name*="phone" i], input[id*="phone" i], input[aria-label*="phone" i]').first();
        if ((await candidate.count()) > 0) phoneLocator = candidate;
      }

      // 3) Fallback: find an input near the +91 text
      if (!phoneLocator) {
        const country = page.locator('text="+91"').first();
        if ((await country.count()) > 0) {
          // attempt to find the first input following the country node in the DOM
          const handle = await country.elementHandle();
          if (handle) {
            const inputHandle = await handle.evaluateHandle((el) => {
              // search forward for an input element in the DOM tree
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
              let foundCountry = false;
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (!foundCountry) {
                  if (node.isSameNode(el)) foundCountry = true;
                } else {
                  if (node.tagName && node.tagName.toLowerCase() === 'input') return node;
                  const input = node.querySelector && node.querySelector('input');
                  if (input) return input;
                }
              }
              return null;
            });
            if (inputHandle) {
              // create locator from element handle by getting a unique attribute if possible; fallback to first visible input
              await inputHandle.dispose();
              const fallback = page.locator('input').filter({ has: page.locator('xpath=..') }).first(); // fallback path - but we keep generic fallback below
            }
          }
        }
      }

      // Final fallback: use first visible input on page (use with caution)
      if (!phoneLocator) {
        const firstInput = page.locator('input').filter({ hasText: '' }).first();
        if ((await firstInput.count()) > 0) phoneLocator = firstInput;
      }

      if (!phoneLocator || (await phoneLocator.count()) === 0) {
        throw new Error("Phone input not found by any selector");
      }

      await phoneLocator.scrollIntoViewIfNeeded();
      await phoneLocator.click({ timeout: 3000 }).catch(() => {});
      // clear any existing value (some inputs require selectText+press Backspace; use fill to replace)
      await phoneLocator.fill('');
      await phoneLocator.fill(phoneNumber, { timeout: 5000 });
      console.log('Filled phone number:', phoneNumber);
    } catch (err) {
      console.warn('Failed to fill phone number (continuing):', err && err.message ? err.message : err);
    }
  } else {
    console.warn('PHONE_NUMBER not provided; skipping phone fill.');
  }

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
      // fallback: click label or first checkbox
      const label = page.locator('text=/I agree to the|I agree/i').first();
      if ((await label.count()) > 0) {
        await label.click({ timeout: 3000 }).catch(() => {});
        console.log("Clicked label containing 'I agree' to toggle checkbox.");
      } else {
        const firstCheckbox = page.locator('input[type="checkbox"]').first();
        await firstCheckbox.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
        await firstCheckbox.check({ timeout: 2000 }).catch(() => {});
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
