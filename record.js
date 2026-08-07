const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const AUTH_PATH = 'auth.json';

async function ensureDir(dir) {
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (e) {}
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

// Human-like random delay
const humanDelay = (min, max) => new Promise(r => 
  setTimeout(r, Math.random() * (max - min) + min)
);

(async () => {
  const url = process.env.TARGET_URL;
  const duration = parseInt(process.env.DURATION_SECONDS || "10", 10);
  const bravePath = process.env.BRAVE_PATH || "/usr/bin/brave-browser";
  const phoneNumber = (process.env.PHONE_NUMBER || "").trim();

  if (!url) {
    console.error("TARGET_URL env var is required");
    process.exit(1);
  }

  console.log(`Launching Brave at ${bravePath}, visiting ${url} for ${duration}s...`);

  const browser = await chromium.launch({
    executablePath: bravePath,
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-web-security",
      "--disable-dev-shm-usage",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ],
  });

  // Check for existing session
  const hasSession = fs.existsSync(AUTH_PATH);
  console.log(hasSession ? `Found existing session at ${AUTH_PATH}` : 'No session found, using stealth mode');

  let context;
  try {
    const contextOptions = {
      viewport: { width: 1920, height: 1080 },
      recordVideo: {
        dir: "videos/",
        size: { width: 1280, height: 720 },
      },
    };
    
    if (hasSession) {
      contextOptions.storageState = AUTH_PATH;
    }
    
    context = await browser.newContext(contextOptions);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).toLowerCase();
    if (msg.includes("ffmpeg") || msg.includes("video") || msg.includes("record")) {
      console.warn("RecordVideo failed. Falling back to context without video.");
      const fallbackOptions = { viewport: { width: 1920, height: 1080 } };
      if (hasSession) fallbackOptions.storageState = AUTH_PATH;
      context = await browser.newContext(fallbackOptions);
    } else {
      console.error("Failed to create browser context:", err);
      await browser.close();
      process.exit(1);
    }
  }

  const page = await context.newPage();

  // Stealth injection (only needed if no session)
  if (!hasSession) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'permissions', {
        get: () => ({ query: () => Promise.resolve({ state: 'prompt' }) })
      });
      delete navigator.__proto__.webdriver;
    });
    
    // Set realistic headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://www.google.com/'
    });
  }

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    console.log("Page loaded successfully");
  } catch (err) {
    console.error(`Failed to load ${url}:`, err && err.message ? err.message : err);
  }

  // Random delay then scroll like human
  await humanDelay(800, 1500);
  await page.mouse.move(Math.random() * 500, Math.random() * 300);
  await page.mouse.wheel(0, 400);
  await humanDelay(500, 1000);

  // --- Check for CAPTCHA (if stealth failed) ---
  try {
    const cfDetected = await page.evaluate(() => {
      return !!document.querySelector('.cf-turnstile, .cf-challenge, iframe[src*="challenges.cloudflare"]');
    });
    
    if (cfDetected && !hasSession) {
      console.log("⚠️  CAPTCHA detected! Stealth mode failed.");
      console.log("Solve it manually now, session will be saved for next run...");
      // Wait longer to give time to solve
      await page.waitForTimeout(10000);
    }
  } catch (e) {}

  // --- Fill phone number ---
  if (phoneNumber) {
    try {
      await humanDelay(300, 600);
      let phoneLocator = null;

      const p = page.getByPlaceholder('Enter 10-digit number', { exact: false }).first();
      if ((await p.count()) > 0) phoneLocator = p;

      if (!phoneLocator) {
        const candidate = page.locator('input[type="tel"], input[placeholder*="10"], input[name*="phone" i], input[id*="phone" i]').first();
        if ((await candidate.count()) > 0) phoneLocator = candidate;
      }

      if (!phoneLocator) {
        const firstInput = page.locator('input').filter({ hasText: '' }).first();
        if ((await firstInput.count()) > 0) phoneLocator = firstInput;
      }

      if (!phoneLocator || (await phoneLocator.count()) === 0) {
        throw new Error("Phone input not found");
      }

      await phoneLocator.scrollIntoViewIfNeeded();
      await humanDelay(200, 400);
      await phoneLocator.click({ timeout: 3000 }).catch(() => {});
      await phoneLocator.fill('');
      await humanDelay(100, 300);
      await phoneLocator.fill(phoneNumber, { timeout: 5000 });
      console.log('Filled phone number:', phoneNumber);
    } catch (err) {
      console.warn('Failed to fill phone number:', err.message);
    }
  }

  // --- Check "I agree" checkbox ---
  try {
    await humanDelay(400, 800);
    const agree = page.getByRole('checkbox', { name: /I agree/i }).first();
    await agree.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    await agree.check({ timeout: 3000 }).catch(() => {});
    console.log("Checked 'I agree' checkbox");
  } catch (e) {
    console.warn("Failed to check 'I agree' checkbox:", e.message);
  }

  // --- Click LAUNCH ATTACK button ---
  try {
    console.log("Waiting 5 seconds safety delay...");
    await page.waitForTimeout(5000);
    
    let launchBtn = null;
    
    try {
      launchBtn = page.getByRole('button', { name: /LAUNCH ATTACK/i });
      await launchBtn.waitFor({ state: 'visible', timeout: 3000 });
    } catch (e) {
      try {
        launchBtn = page.locator('button:has-text("LAUNCH ATTACK")');
        await launchBtn.waitFor({ state: 'visible', timeout: 2000 });
      } catch (e2) {
        launchBtn = page.locator('button[class*="bg-blue"], button[class*="launch"], button[type="submit"]').first();
      }
    }
    
    if (launchBtn) {
      await launchBtn.scrollIntoViewIfNeeded();
      await humanDelay(200, 500);
      await launchBtn.click({ timeout: 5000 });
      console.log("Clicked LAUNCH ATTACK button");
      await page.waitForTimeout(2000);
    }
  } catch (err) {
    console.warn("Failed to click Launch Attack:", err.message);
  }

  // Wait for recording
  await page.waitForTimeout(duration * 1000);

  // Capture artifacts
  try {
    await ensureDir("screenshots");
    await ensureDir("artifacts");
    const timestamp = Date.now();
    const screenshotPath = path.join("screenshots", `screenshot-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const htmlContent = await page.content().catch(() => "<html><body>no-html</body></html>");
    const htmlPath = `page-${timestamp}.html`;
    await fs.promises.writeFile(path.join("artifacts", htmlPath), htmlContent, "utf8");
    console.log("Saved screenshot and HTML");
  } catch (e) {
    console.warn("Failed to capture artifacts:", e.message);
  }

  // Save session for next run (only if page loaded successfully)
  try {
    await context.storageState({ path: AUTH_PATH });
    console.log(`Session saved to ${AUTH_PATH} - commit this file for Actions`);
  } catch (e) {
    console.warn("Failed to save session:", e.message);
  }

  await context.close();
  await browser.close();

  const videoFiles = await findAnyVideoFiles("videos");
  if (videoFiles.length > 0) {
    console.log("Video files produced:");
    for (const f of videoFiles) console.log(" -", f);
    process.exit(0);
  }

  console.log("No video files found. Check screenshots/ and artifacts/");
  process.exit(0);
})();
