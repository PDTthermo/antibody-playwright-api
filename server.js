// server.js
import express from "express";
import { chromium } from "playwright";

const app = express();

/* =========================
   TUNABLE SETTINGS
   ========================= */
const PORT = process.env.PORT || 3000;
const MAX_CONCURRENCY = 3;              // limit parallel pages on free tier
const PAGE_GOTO_TIMEOUT = 25000;        // ms
const SELECTOR_TIMEOUT = 10000;         // ms
const SHORT_WAIT = 600;                 // ms
const SCROLL_PASSES = 3;                // keep small
const LOAD_MORE_ATTEMPTS = 6;           // try a few times only
const DEFAULT_LIMIT = 25;
const DEFAULT_OFFSET = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;     // 5 minutes
const ENABLE_CACHE = true;

/* =========================
   GLOBAL BROWSER (warm)
   ========================= */
let browserPromise = null;
let activePages = 0;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

async function acquireSlot() {
  while (activePages >= MAX_CONCURRENCY) {
    await new Promise((r) => setTimeout(r, 120));
  }
  activePages++;
}

function releaseSlot() {
  activePages = Math.max(0, activePages - 1);
}

/* =========================
   SMALL UTILITIES
   ========================= */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normVendor(vIn) {
  const v = String(vIn || "").toLowerCase();
  if (v.includes("biolegend")) return "biolegend";
  if (v === "bd" || v.includes("biosciences")) return "bd";
  if (v.includes("thermo") || v.includes("fisher")) return "thermo";
  return null;
}

function normLaser(lIn) {
  const l = String(lIn || "").toLowerCase();
  const map = {
    uv: "uv",
    violet: "violet",
    blue: "blue",
    yg: "yg",
    yellow: "yg",
    "yellow-green": "yg",
    "yellow green": "yg",
    green: "yg",
    red: "red",
  };
  return map[l] || null;
}

function normalizeSpecies(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// basic aliasing so your API succeeds even if user sends shorthand
function normalizeTarget(tIn) {
  let t = String(tIn || "").trim();
  const low = t.toLowerCase();
  const map = {
    "tcrgd": "tcr gamma delta",
    "tcrγδ": "tcr gamma delta",
    "ifng": "ifn gamma",
    "ifnγ": "ifn gamma",
    "tnfa": "tnf alpha",
    "tnfα": "tnf alpha",
    "cd45r/b220": "cd45r b220",
  };
  if (map[low]) return map[low];
  return t;
}

// strip trivial query params from links for dedupe
function canonicalLink(href) {
  try {
    const u = new URL(href);
    u.search = ""; // drop query for stricter dedupe; keep path/host
    return u.toString();
  } catch {
    return href;
  }
}

// universal dedupe (exact + near dupes)
function dedupeRows(rows) {
  const exactSeen = new Set();
  const kept = [];

  for (const r of rows) {
    const keyExact = [
      r.vendor || "",
      (r.target || "").toLowerCase(),
      (r.species || "").toLowerCase(),
      (r.conjugate || "").toLowerCase(),
      (r.product_name || "").replace(/\s+/g, " ").trim().toLowerCase(),
      canonicalLink(r.link || "")
    ].join("|");

    if (exactSeen.has(keyExact)) continue;
    exactSeen.add(keyExact);
    kept.push({ ...r, link: canonicalLink(r.link || "") });
  }

  // near-dup squashing: same vendor/target/species/conjugate; minor name diffs
  const nearSeen = new Map(); // key → first index
  const final = [];
  for (const r of kept) {
    const nearKey = [
      r.vendor || "",
      (r.target || "").toLowerCase(),
      (r.species || "").toLowerCase(),
      (r.conjugate || "").toLowerCase(),
    ].join("|");

    const normName = String(r.product_name || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      // remove trivial test counts / units when present in name
      .replace(/\b(\d+\s?tests?|test|µg|ug|vial|pack)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const stored = nearSeen.get(nearKey);
    if (!stored) {
      nearSeen.set(nearKey, { normName, link: r.link });
      final.push(r);
    } else {
      // if the only diff is trivial (very similar), skip it
      if (stored.normName === normName) {
        continue;
      } else {
        // different enough: keep
        final.push(r);
      }
    }
  }

  return final;
}

/* =========================
   REQUEST OPTIMIZATION
   ========================= */
async function optimizePage(page, vendor) {
  const vendorHost =
    vendor === "biolegend"
      ? "www.biolegend.com"
      : vendor === "bd"
      ? "www.bdbiosciences.com"
      : "www.thermofisher.com";

  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  await page.route("**/*", (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    // Block heavy resources
    if (
      type === "image" ||
      type === "media" ||
      type === "font" ||
      type === "stylesheet"
    ) {
      return route.abort();
    }

    // Allow only first-party + essential assets
    try {
      const u = new URL(url);
      const host = u.hostname;
      if (!host.endsWith(vendorHost)) {
        // allow some CDNs if vendor depends on them
        const allowed = [
          "static.biolegend.com",
          "assets.biolegend.com",
          "static.bdbiosciences.com",
          "assets.bdbiosciences.com",
          "assets.thermofisher.com",
          "cdn.thermofisher.com",
        ];
        if (!allowed.some((h) => host.endsWith(h))) {
          return route.abort();
        }
      }
    } catch {
      // ignore URL parse errors; continue
    }

    return route.continue();
  });
}

async function acceptCookies(page) {
  const sels = [
    "#onetrust-accept-btn-handler",
    "button#onetrust-accept-btn-handler",
    "#truste-consent-button",
    "button#truste-consent-button",
    'button[aria-label*="Accept"]',
    'button:has-text("Accept All")',
    'button:has-text("I Accept")',
    'button:has-text("Got it")',
  ];
  for (const s of sels) {
    try {
      const el = await page.$(s);
      if (el) {
        await el.click({ timeout: 800 });
        await page.waitForTimeout(300);
      }
    } catch {}
  }
}

async function autoScroll(page, passes = SCROLL_PASSES) {
  for (let i = 0; i < passes; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
    await page.waitForTimeout(SHORT_WAIT);
  }
}

async function clickLoadMoreIfAny(page, attempts = LOAD_MORE_ATTEMPTS) {
  const sels = [
    'button:has-text("Load more")',
    'button:has-text("Load 25 more results")',
    'button:has-text("Show more")',
  ];
  for (let i = 0; i < attempts; i++) {
    let clicked = false;
    for (const s of sels) {
      const btn = await page.$(s);
      if (btn) {
        try {
          await btn.click();
          clicked = true;
          await page.waitForTimeout(900);
        } catch {}
      }
    }
    if (!clicked) break;
    await autoScroll(page, 2);
  }
}

/* =========================
   URL BUILDERS
   ========================= */
const URL_MAP = {
  biolegend: {
    blue: (target, species) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=bluelaser&Keywords=${encodeURIComponent(
        target
      )}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
    uv: (target, species) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=uvlaser&Keywords=${encodeURIComponent(
        target
      )}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
    violet: (target, species) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=violetlaser&Keywords=${encodeURIComponent(
        target
      )}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
    yg: (target, species) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=yellowgreenlaser&Keywords=${encodeURIComponent(
        target
      )}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
    red: (target, species) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=redlaser&Keywords=${encodeURIComponent(
        target
      )}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
  },
  thermo: {
    blue: (target, species) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        target
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        species
      )}/compatibility/488+nm+(Blue)`,
    uv: (target, species) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        target
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        species
      )}/compatibility/355+nm+(UV)`,
    violet: (target, species) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        target
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        species
      )}/compatibility/405+nm+(Violet)`,
    yg: (target, species) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        target
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        species
      )}/compatibility/561+nm+(Yellow-Green)`,
    red: (target, species) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        target
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        species
      )}/compatibility/633+nm+(Red)`,
  },
  bd: {
    blue: (target, species) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        target
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        species
      )}%22=%22${encodeURIComponent(
        species
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Blue%20488%20nm%22=%22Blue%20488%20nm%22`,
    uv: (target, species) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        target
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        species
      )}%22=%22${encodeURIComponent(
        species
      )}%22&applicationName_facet_ss::%22Flow%20cytrometry%22=%22Flow%20cytrometry%22&excitationSource_facet_s::%22UV%20Laser%22=%22UV%20Laser%22`,
    violet: (target, species) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        target
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        species
      )}%22=%22${encodeURIComponent(
        species
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Violet%20405%20nm%22=%22Violet%20405%20nm%22`,
    yg: (target, species) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        target
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        species
      )}%22=%22${encodeURIComponent(
        species
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Yellow-Green%20561%20nm%22=%22Yellow-Green%20561%20nm%22`,
    red: (target, species) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        target
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        species
      )}%22=%22${encodeURIComponent(
        species
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Red%20627-640%20nm%22=%22Red%20627-640%20nm%22`,
  },
};

/* =========================
   CACHING (optional)
   ========================= */
const cache = new Map(); // key -> { t, payload }
function cacheKey(obj) {
  return JSON.stringify(obj);
}
function getCached(k) {
  if (!ENABLE_CACHE) return null;
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() - hit.t > CACHE_TTL_MS) {
    cache.delete(k);
    return null;
  }
  return hit.payload;
}
function setCached(k, payload) {
  if (!ENABLE_CACHE) return;
  cache.set(k, { t: Date.now(), payload });
}

/* =========================
   SCRAPERS (minimal waits)
   ========================= */
async function scrapeBioLegend(page, startUrl, target, species) {
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: PAGE_GOTO_TIMEOUT });
  await acceptCookies(page);
  await autoScroll(page, 2);
  await clickLoadMoreIfAny(page, LOAD_MORE_ATTEMPTS);

  // primary selector you provided
  const anchors = await page.$$eval("li.row.list h2 a[itemprop='name']", (els) =>
    els.map((a) => {
      const name = (a.textContent || "").trim().replace(/\s+/g, " ");
      let href = a.getAttribute("href") || "";
      if (href && !/^https?:\/\//i.test(href)) {
        href = "https://www.biolegend.com" + (href.startsWith("/") ? href : "/" + href);
      }
      return { name, href };
    })
  ).catch(() => []);

  const rows = anchors.map(({ name, href }) => {
    let conjugate = name;
    const idx = name.toLowerCase().indexOf(" anti-");
    if (idx > 0) conjugate = name.slice(0, idx).trim();
    return {
      vendor: "BioLegend",
      product_name: name,
      target,
      species,
      conjugate,
      link: href,
    };
  });

  // attempt to read visible total number if present (optional)
  let total = rows.length;
  try {
    const t = await page.$eval(".resultCount, .viewing-results", (el) =>
      (el.textContent || "").replace(/\s+/g, " ")
    );
    const m = /(\d[\d,]*)\s*(results|of)/i.exec(t);
    if (m) total = parseInt(m[1].replace(/,/g, ""), 10);
  } catch {}

  return { rows, total };
}

async function scrapeThermo(page, startUrl, target, species) {
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: PAGE_GOTO_TIMEOUT });
  await acceptCookies(page);
  await autoScroll(page, 2);
  await clickLoadMoreIfAny(page, LOAD_MORE_ATTEMPTS);

  const blocksSel = "div.flex-container.product-info.ab-primary";
  await page.waitForSelector(blocksSel, { timeout: SELECTOR_TIMEOUT }).catch(() => {});
  let rows = await page.$$eval(blocksSel, (blocks) =>
    blocks
      .map((b) => {
        const a = b.querySelector("a.product-desc, a.product-desc-new");
        const name = a ? a.textContent.trim().replace(/\s+/g, " ") : null;
        const href = a ? a.getAttribute("href") : null;
        const link =
          href && href.startsWith("http")
            ? href
            : href
            ? "https://www.thermofisher.com" + href
            : null;
        const hasSpecies = !!b.querySelector(".item.species-item");
        return name && link && hasSpecies
          ? { vendor: "Thermo Fisher", product_name: name, link }
          : null;
      })
      .filter(Boolean)
  ).catch(() => []);

  rows = rows.map((r) => ({
    vendor: r.vendor,
    product_name: r.product_name,
    target,
    species,
    conjugate:
      (/\)\s*,\s*([^,]+)(?:,|$)/.exec(r.product_name) || [null, r.product_name])[1].trim(),
    link: r.link,
  }));

  return { rows, total: rows.length };
}

async function scrapeBD(page, startUrl, target, species) {
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: PAGE_GOTO_TIMEOUT });
  await acceptCookies(page);
  await autoScroll(page, 2);
  await clickLoadMoreIfAny(page, LOAD_MORE_ATTEMPTS);

  const cardsSel = "div.pdp-search-card__body, .pdp-search-card, article.pdp-search-card";
  await page.waitForSelector(cardsSel, { timeout: SELECTOR_TIMEOUT }).catch(() => {});
  let rows = await page.$$eval(cardsSel, (cards) =>
    cards
      .map((card) => {
        const a =
          card.querySelector(
            "a.card-title.pdp-search-card__body-title, a.card-title, a[href*='/products/'], a[href*='/en-us/products/']"
          ) || null;
        const name = a ? a.textContent.trim().replace(/\s+/g, " ") : null;
        let href = a ? a.getAttribute("href") : null;
        if (href && !href.startsWith("http")) {
          href = "https://www.bdbiosciences.com" + href;
        }
        return name && href && href.includes("bdbiosciences.com")
          ? { vendor: "BD Biosciences", product_name: name, link: href }
          : null;
      })
      .filter(Boolean)
  ).catch(() => []);

  rows = rows.map((r) => ({
    ...r,
    target,
    species,
    conjugate: (/\)\s*(.*)$/.exec(r.product_name) || [null, r.product_name])[1].trim(),
  }));

  return { rows, total: rows.length };
}

/* =========================
   SEARCH ROUTE (JSON)
   ========================= */
app.get("/search", async (req, res) => {
  const vendorRaw = req.query.vendor || "";
  const targetRaw = req.query.target || "";
  const speciesRaw = req.query.species || "Human";
  const laserRaw = req.query.laser || "";
  const override = req.query.override_url || "";
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || DEFAULT_LIMIT, 10)));
  const offset = Math.max(0, parseInt(req.query.offset || DEFAULT_OFFSET, 10));
  const debug = (req.query.debug || "") === "1";

  const vendor = normVendor(vendorRaw);
  const laser = normLaser(laserRaw);
  const species = normalizeSpecies(speciesRaw);
  const target = normalizeTarget(targetRaw);

  if (!vendor || !target || !species || !laser) {
    return res.status(400).json({ error: "bad_params" });
  }

  const key = cacheKey({ vendor, target, species, laser }); // cache per full set
  const cached = getCached(key);
  if (cached) {
    // slice on API layer (fast)
    const deduped = dedupeRows(cached.rows || []);
    const total = cached.total ?? deduped.length;
    const pageRows = deduped.slice(offset, offset + limit);
    return res.json({ rows: pageRows, total, vendor, target, species, laser, cached: true });
  }

  let context, page;
  try {
    await acquireSlot();
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    page = await context.newPage();

    await optimizePage(page, vendor);

    const builder = URL_MAP[vendor][laser];
    const startUrl = override || builder(target, species);

    let result = { rows: [], total: 0 };
    if (vendor === "biolegend") result = await scrapeBioLegend(page, startUrl, target, species);
    else if (vendor === "thermo") result = await scrapeThermo(page, startUrl, target, species);
    else result = await scrapeBD(page, startUrl, target, species);

    // Cache full set (pre-sliced), then slice for response
    setCached(key, result);

    const deduped = dedupeRows(result.rows || []);
    const total = result.total || deduped.length;
    const pageRows = deduped.slice(offset, offset + limit);

    return res.json({
      rows: pageRows,
      total,
      vendor,
      target,
      species,
      laser,
      url: debug ? startUrl : undefined,
    });
  } catch (e) {
    return res.status(502).json({ error: "fetch_or_parse_failed", detail: String(e) });
  } finally {
    try {
      if (page) await page.close();
      if (context) await context.close();
    } catch {}
    releaseSlot();
  }
});

/* =========================
   TABLE ROUTE (HTML helper)
   ========================= */
app.get("/table", async (req, res) => {
  // proxy to /search then render simple table
  const url = new URL(req.protocol + "://" + req.get("host") + req.originalUrl);
  url.pathname = "/search";
  const params = Object.fromEntries(url.searchParams.entries());

  // local call
  req.url = "/search?" + new URLSearchParams(params).toString();
  const send = res.json.bind(res);

  // intercept JSON and render HTML
  res.json = (payload) => {
    if (payload.error) return send(payload);
    const { rows = [], total = rows.length, vendor, target, species, laser } = payload;

    const header = `<h3>Results for ${target} / ${species} / ${laser} — ${vendor} (showing ${rows.length} of ${total})</h3>`;
    const table =
      `<table border="1" cellpadding="6" cellspacing="0">` +
      `<thead><tr><th>#</th><th>Vendor</th><th>Product Name</th><th>Target</th><th>Species</th><th>Conjugate</th><th>Link</th></tr></thead>` +
      `<tbody>` +
      rows
        .map((r, i) => {
          const link = r.link ? `<a href="${r.link}" target="_blank" rel="noopener">Open</a>` : "";
          return `<tr>
            <td>${i + 1}</td>
            <td>${r.vendor || ""}</td>
            <td>${r.product_name || ""}</td>
            <td>${r.target || ""}</td>
            <td>${r.species || ""}</td>
            <td>${r.conjugate || ""}</td>
            <td>${link}</td>
          </tr>`;
        })
        .join("") +
      `</tbody></table>`;
    res.type("text/html").send(header + table);
  };

  app._router.handle(req, res, () => {});
});

/* =========================
   ROOT / HEALTH
   ========================= */
app.get("/", (req, res) => {
  res
    .type("text/plain")
    .send(
      "Antibody Playwright API running.\nTry JSON: /search?vendor=BioLegend&target=CCR7&species=Human&laser=Blue&limit=25&offset=0\nTry HTML: /table?vendor=BD&target=CD3&species=Human&laser=Red&limit=25&offset=0"
    );
});

/* =========================
   START
   ========================= */
app.listen(PORT, () => {
  console.log("Playwright API listening on " + PORT);
});
