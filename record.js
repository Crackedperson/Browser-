const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const AUTH_PATH = 'auth.json';
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';

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
        } else if (/\.(webm|mp4|mkv|mov)$/i.test(ent.name)) {
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

async function getFlareSolverrCookies(targetUrl) {
  try {
    const response = await fetch(FLARESOLVERR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'request.get',
        url: targetUrl,
        maxTimeout: 60000
      })
    });
    
    const data = await response.json();
    if (data.status === 'ok') {
      console.log('✓ FlareSolverr bypassed Cloudflare');
      return {
        cookies: data.solution.cookies,
        userAgent: data.solution.userAgent
      };
    }
  } catch (e) {
    console.log('✗ FlareSolverr not available');
  }
  return null;
}

async function applyEnhancedStealth(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { 
      get: () => [
        {name: "Chrome PDF Plugin", filename: "internal-pdf-viewer"},
        {name: "Native Client", filename: "native-client.nmf"}
      ] 
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    
    window.chrome = { 
      runtime: {
        OnInstalledReason: {CHROME_UPDATE: "chrome_update"},
        PlatformArch: {X86_64: "x86-64"},
        PlatformOs: {LINUX: "linux"}
      }
    };
    
    Object.defineProperty(navigator, 'permissions', {
      get: () => ({ query: () => Promise.resolve({ state: 'prompt' }) })
    });
    
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type) {
      const context = originalGetContext.call(this, type);
      if (type === '2d' && context) {
        context.canvas.dataset.fingerprint = Math.random().toString(36);
      }
      return context;
    };
    
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris Xe Graphics';
      return getParameter.call(this, parameter);
    };
    
    delete navigator.__proto__.webdriver;
  });
}

const humanDelay = (min, max) => new Promise(r => 
  setTimeout(r, Math.random() * (max - min) + min)
);

async function humanMouseMove(page, targetX, targetY) {
  const startX = Math.floor(Math.random() * 200) + 50;
  const startY = Math.floor(Math.random() * 200) + 50;
  const steps = Math.floor(Math.random() * 15) + 10;
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const curveX = Math.sin(t * Math.PI) * (Math.random() * 60 - 30);
    const curveY = Math.cos(t * Math.PI) * (Math.random() * 40 - 20);
    const x = startX + (targetX - startX) * t + curveX;
    const y = startY + (targetY - startY) * t + curveY;
    
    await page.mouse.move(x, y);
    await humanDelay(8, 20);
  }
}

async function humanScroll(page, amount) {
  const steps = Math.floor(Math.abs(amount) / 50) + 3;
  const perStep = amount / steps;
  
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, perStep);
    await humanDelay(50, 150);
  }
}

async function humanType(page, locator, text) {
  await locator.click();
  await humanDelay(150, 350);
  
  await locator.press('Control+a');
  await humanDelay(50, 150);
  await locator.press('Delete');
  await humanDelay(200, 400);
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (Math.random() < 0.03 && i > 0) {
      const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
      await locator.type(wrongChar, { delay: Math.random() * 60 + 40 });
      await humanDelay(150, 400);
      await locator.press('Backspace');
      await humanDelay(100, 250);
    }
    
    await locator.type(char, { delay: Math.random() * 80 + 30 });
    await humanDelay(20, 80);
  }
}

(async () => {
  const url = process.env.TARGET_URL;
  const duration = parseInt(process.env.DURATION_SECONDS || "10", 10);
  const bravePath = process.env.BRAVE_PATH || "/usr/bin/brave-browser";
  const phoneNumber = (process.env.PHONE_NUMBER || "").trim();
  const proxy = process.env.PROXY_SERVER;

  if (!url) {
    console.error("TARGET_URL env var is required");
    process.exit(1);
  }

  let flareCookies = null;
  if (!fs.existsSync(AUTH_PATH)) {
    console.log("Trying FlareSolverr...");
    flareCookies = await getFlareSolverrCookies(url);
  }

  console.log(`Launching Brave, visiting ${url} for ${duration}s...`);

  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-web-security",
    "--disable-dev-shm-usage",
    "--window-size=1920,1080"
  ];

  if (proxy) {
    launchArgs.push(`--proxy-server=${proxy}`);
    console.log("Using proxy:", proxy);
  }

  const browser = await chromium.launch({
    executablePath: bravePath,
    headless: false,
    args: launchArgs,
  });

  const hasSession = fs.existsSync(AUTH_PATH);
  
  let context;
  try {
    const contextOptions = {
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: "videos/", size: { width: 1280, height: 720 } },
    };
    
    if (hasSession) {
      contextOptions.storageState = AUTH_PATH;
      console.log("Using saved session");
    }
    
    context = await browser.newContext(contextOptions);
    
    if (flareCookies && !hasSession) {
      await context.addCookies(flareCookies.cookies.map(c => ({
        name: c.name, value: c.value, domain: c.domain,
        path: c.path, expires: c.expires, httpOnly: c.httpOnly,
        secure: c.secure, sameSite: c.sameSite
      })));
    }
  } catch (err) {
    console.warn("Video recording failed, retrying:", err.message);
    const fallback = { viewport: { width: 1920, height: 1080 } };
    if (hasSession) fallback.storageState = AUTH_PATH;
    context = await browser.newContext(fallback);
  }

  const page = await context.newPage();
  await applyEnhancedStealth(page);
  
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Referer': 'https://www.google.com/',
    'sec-ch-ua': '"Chromium";v="126", "Brave";v="126"'
  });

  await page.mouse.move(Math.random() * 400, Math.random() * 300);

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    console.log("Page loaded");
  } catch (err) {
    console.error("Load error:", err.message);
  }

  await humanDelay(1000, 2000);
  await humanMouseMove(page, 400, 300);
  await humanScroll(page, 400);
  await humanDelay(800, 1500);

  const cfPresent = await page.evaluate(() => {
    return !!document.querySelector('.cf-turnstile, .cf-challenge');
  });
  
  if (cfPresent) {
    console.log("⚠️  CAPTCHA detected. Solve manually or check session...");
    await page.waitForTimeout(10000);
  }

  if (phoneNumber) {
    try {
      await humanDelay(600, 1200);
      const phoneLocator = 
        page.locator('input[type="tel"]').first() ||
        page.locator('input[placeholder*="10"]').first() ||
        page.locator('input').first();
      
      if (await phoneLocator.count() > 0) {
        const box = await phoneLocator.boundingBox();
        if (box) await humanMouseMove(page, box.x + box.width/2, box.y + box.height/2);
        await humanType(page, phoneLocator, phoneNumber);
        console.log('Phone entered');
      }
    } catch (err) {
      console.warn('Phone error:', err.message);
    }
  }

  try {
    await humanDelay(400, 800);
    const agree = page.getByRole('checkbox', { name: /I agree/i }).first();
    const box = await agree.boundingBox().catch(() => null);
    if (box) {
      await humanMouseMove(page, box.x + box.width/2, box.y + box.height/2);
      await humanDelay(200, 400);
    }
    await agree.check({ timeout: 5000 }).catch(() => {});
    console.log("Checked agreement");
  } catch (e) {}

  try {
    console.log("Safety delay...");
    await page.waitForTimeout(5000);
    const launchBtn = page.getByRole('button', { name: /LAUNCH ATTACK/i }).first();
    
    if (await launchBtn.count() > 0) {
      const box = await launchBtn.boundingBox();
      if (box) await humanMouseMove(page, box.x + box.width/2, box.y + box.height/2);
      if (Math.random() < 0.3) await humanDelay(600, 1200);
      await launchBtn.click({ timeout: 5000 });
      console.log("Clicked launch");
    }
  } catch (err) {
    console.warn("Launch error:", err.message);
  }

  await page.waitForTimeout(duration * 1000);

  try {
    await ensureDir("screenshots");
    await ensureDir("artifacts");
    const ts = Date.now();
    await page.screenshot({ path: `screenshots/screenshot-${ts}.png`, fullPage: true });
    const html = await page.content();
    await fs.promises.writeFile(`artifacts/page-${ts}.html`, html);
  } catch (e) {}

  try {
    await context.storageState({ path: AUTH_PATH });
    console.log("Session saved to auth.json");
  } catch (e) {
    console.warn("Session save failed:", e.message);
  }

  await context.close();
  await browser.close();
  
  const videos = await findAnyVideoFiles("videos");
  if (videos.length > 0) {
    console.log("Videos:", videos);
    process.exit(0);
  }
  
  console.log("Done. Check screenshots/ and artifacts/");
  process.exit(0);
})();
