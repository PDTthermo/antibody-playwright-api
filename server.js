// server.js
import express from "express";
import { chromium } from "playwright";

const app = express();

/* ----------------------------- Helpers ----------------------------- */
const normVendor = (vRaw) => {
  const v = String(vRaw || "").toLowerCase().trim();
  if (!v) return null;
  if (v.includes("biolegend")) return "biolegend";
  if (v.includes("thermo") || v.includes("invitrogen") || v.includes("ebioscience")) return "thermo";
  if (v === "bd" || v.includes("biosciences")) return "bd";
  return null;
};

const normLaser = (lRaw) => {
  const l = String(lRaw || "").toLowerCase().trim();
  const map = {
    uv: "uv",
    violet: "violet",
    blue: "blue",
    yg: "yg",
    "yellow": "yg",
    "yellow-green": "yg",
    "yellow green": "yg",
    "green": "yg",
    red: "red",
  };
  return map[l] || null;
};

const acceptCookies = async (page) => {
  const selectors = [
    "#onetrust-accept-btn-handler",
    "button#onetrust-accept-btn-handler",
    "#truste-consent-button",
    "button#truste-consent-button",
    'button[aria-label*="Accept"]',
    'button:has-text("Accept All")',
    'button:has-text("I Accept")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
  ];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({ timeout: 1200 });
        await page.waitForTimeout(300);
      }
    } catch {}
  }
};

const goProductsTabIfAny = async (page) => {
  const tabSel = [
    'a[role="tab"]:has-text("Products")',
    'button[role="tab"]:has-text("Products")',
    'a:has-text("Products")',
  ];
  for (const sel of tabSel) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ timeout: 1200 });
        await page.waitForTimeout(500);
      }
    } catch {}
  }
};

const autoScroll = async (page, passes = 4, pauseMs = 600) => {
  for (let i = 0; i < passes; i++) {
    try {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.25));
      await page.waitForTimeout(pauseMs);
    } catch {}
  }
};

const clickLoadMoreIfAny = async (page, attempts = 6) => {
  const selectors = [
    'button:has-text("Load more")',
    'button:has-text("Load 25 more results")',
    'button:has-text("Show more")',
  ];
  for (let i = 0; i < attempts; i++) {
    let clicked = false;
    for (const sel of selectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          clicked = true;
          await page.waitForTimeout(1200);
        }
      } catch {}
    }
    if (!clicked) break;
    await autoScroll(page, 2, 500);
  }
};

const domainOK = (vendor) =>
  vendor === "BioLegend"
    ? "biolegend.com"
    : vendor === "Thermo Fisher"
    ? "thermofisher.com"
    : "bdbiosciences.com";

/* ----------------------------- URL Map ----------------------------- */
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
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22UV%20Laser%22=%22UV%20Laser%22`,
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

/* -------------------------- Vendor scrapers -------------------------- */
// BioLegend: paginates with &Page=N
async function scrapeBioLegend(page, baseUrl, target, species, maxPages = 60) {
  // ensure clean base (strip existing &Page=)
  const start = baseUrl.replace(/([?&])Page=\d+/i, "$1").replace(/[?&]$/, "");
  const makeUrl = (n) => start + (start.includes("?") ? `&Page=${n}` : `?Page=${n}`);

  const seenLinks = new Set();
  const all = [];

  // shared prep
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  for (let p = 1; p <= maxPages; p++) {
    const url = makeUrl(p);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await acceptCookies(page);
    await page.waitForTimeout(400);
    await autoScroll(page, 4, 500);

    const rows = await page.$$eval("li.row.list h2 a[itemprop='name']", (els) =>
      els.map((a) => {
        const name = (a.textContent || "").trim().replace(/\s+/g, " ");
        let href = a.getAttribute("href") || "";
        if (href && !/^https?:\/\//i.test(href)) {
          href = "https://www.biolegend.com" + (href.startsWith("/") ? href : "/" + href);
        }
        return { name, href };
      })
    );

    let added = 0;
    for (const { name, href } of rows) {
      if (!href || seenLinks.has(href)) continue;
      seenLinks.add(href);

      // conjugate = everything before " anti-"
      let conjugate = name;
      const idx = name.toLowerCase().indexOf(" anti-");
      if (idx > 0) conjugate = name.slice(0, idx).trim();

      all.push({
        vendor: "BioLegend",
        product_name: name,
        target,
        species,
        conjugate,
        link: href,
      });
      added++;
    }
    if (added === 0) break; // no new items → stop
  }
  return all;
}

// Thermo Fisher: click "Load more" and scrape product cards
async function scrapeThermo(page, url, target, species) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await acceptCookies(page);
  await goProductsTabIfAny(page);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await autoScroll(page, 6, 500);
  await clickLoadMoreIfAny(page, 6);

  let rows = await page.$$eval(
    "div.flex-container.product-info.ab-primary",
    (blocks) =>
      blocks
        .map((b) => {
          const a = b.querySelector("a.product-desc, a.product-desc-new");
          const name = a ? a.textContent.trim().replace(/\s+/g, " ") : null;
          const href = a ? a.getAttribute("href") : null;
          const link = href
            ? href.startsWith("http")
              ? href
              : "https://www.thermofisher.com" + href
            : null;
          const hasSpecies = !!b.querySelector(".item.species-item");
          return name && link
            ? { vendor: "Thermo Fisher", product_name: name, link, hasSpecies }
            : null;
        })
        .filter(Boolean)
  );

  rows = rows
    .filter((r) => r.hasSpecies)
    .map((r) => ({
      vendor: r.vendor,
      product_name: r.product_name,
      target,
      species,
      conjugate: ((m) => (m ? m[1].trim() : r.product_name))(
        /\)\s*,\s*([^,]+)(?:,|$)/.exec(r.product_name)
      ),
      link: r.link,
    }));

  return rows;
}

// BD Biosciences: click "Show more"/"Load more", scrape cards
async function scrapeBD(page, url, target, species) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await acceptCookies(page);
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(600);
  await autoScroll(page, 4, 500);
  await clickLoadMoreIfAny(page, 8);

  const cardSel = "div.pdp-search-card__body, .pdp-search-card, article.pdp-search-card";
  let rows = await page.$$eval(cardSel, (cards) =>
    cards
      .map((card) => {
        const a =
          card.querySelector(
            "a.card-title.pdp-search-card__body-title, a.card-title, a[href*='/products/'], a[href*='/en-us/products/']"
          ) || null;
        const name = a ? a.textContent.trim().replace(/\s+/g, " ") : null;
        let href = a ? a.getAttribute("href") : null;
        if (href && !href.startsWith("http")) href = "https://www.bdbiosciences.com" + href;
        return name && href && href.includes("bdbiosciences.com")
          ? { vendor: "BD Biosciences", product_name: name, link: href }
          : null;
      })
      .filter(Boolean)
  );

  rows = rows.map((r) => ({
    ...r,
    target,
    species,
    conjugate: ((m) => (m ? m[1].trim() : r.product_name))(/\)\s*(.*)$/.exec(r.product_name)),
  }));

  return rows;
}

/* ------------------------------- Routes ------------------------------- */
app.get("/", (_req, res) => {
  res
    .type("text/plain")
    .send(
      "Antibody Playwright API is running.\nTry:\n/search?vendor=BioLegend&target=CD3&species=Human&laser=Blue&limit=20&offset=0\n/table?vendor=BioLegend&target=CD3&species=Human&laser=Blue&limit=20&offset=0"
    );
});

app.get("/search", async (req, res) => {
  const vendor = normVendor(req.query.vendor);
  const target = (req.query.target || "").trim();
  const species = (req.query.species || "Human").trim();
  const laser = normLaser(req.query.laser);
  const override = req.query.override_url || "";
  const debugWanted = (req.query.debug || "") === "1";

  // pagination controls for API response slicing
  let limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10) || 50, 1), 200);
  let offset = Math.max(parseInt(req.query.offset || "0", 10) || 0, 0);

  if (!vendor || !target || !species || !laser) {
    return res.status(400).json({ error: "bad_params" });
  }

  const urlBuilder = URL_MAP[vendor] && URL_MAP[vendor][laser];
  if (!urlBuilder && !override) {
    return res.status(400).json({ error: "unsupported_vendor_or_laser" });
  }

  const startUrl = override || urlBuilder(target, species);

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    let rows = [];
    if (vendor === "biolegend") {
      rows = await scrapeBioLegend(page, startUrl, target, species, 80); // allow many pages
    } else if (vendor === "thermo") {
      rows = await scrapeThermo(page, startUrl, target, species);
    } else if (vendor === "bd") {
      rows = await scrapeBD(page, startUrl, target, species);
    }

    // domain guard + exact-duplicate removal
    const seen = new Set();
    const final = [];
    for (const r of rows) {
      if (!r.link || !r.link.includes(domainOK(r.vendor))) continue;
      const key = `${r.vendor}|${(r.product_name || "").trim()}|${r.link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      final.push(r);
    }

    const total = final.length;
    const sliced = final.slice(offset, offset + limit);

    const payload = debugWanted
      ? { total, limit, offset, rows: sliced, debug: { startUrl } }
      : { total, limit, offset, rows: sliced };

    return res.json(payload);
  } catch (e) {
    return res.status(502).json({ error: "fetch_or_parse_failed", detail: String(e) });
  } finally {
    await browser.close();
  }
});

// Nicely formatted HTML table (for quick eyeballing)
app.get("/table", async (req, res) => {
  // proxy to /search then render a table
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) params.set(k, v);
  const base = req.protocol + "://" + req.get("host");
  const url = `${base}/search?${params.toString()}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    const rows = data.rows || [];
    const total = data.total || rows.length;
    const limit = data.limit ?? rows.length;
    const offset = data.offset ?? 0;

    const header =
      `<h2>Results for ${req.query.target || ""} (${req.query.laser || ""}) — showing ${rows.length} of ${total} (limit=${limit}, offset=${offset})</h2>`;
    const tableHead =
      `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Arial, sans-serif;font-size:13px;">
        <thead><tr>
          <th>#</th><th>Vendor</th><th>Product Name</th><th>Target</th><th>Species</th><th>Conjugate</th><th>Link</th>
        </tr></thead><tbody>`;
    const tableRows = rows
      .map((r, i) => {
        const n = offset + i + 1;
        return `<tr>
          <td>${n}</td>
          <td>${r.vendor || ""}</td>
          <td>${escapeHtml(r.product_name || "")}</td>
          <td>${escapeHtml(r.target || "")}</td>
          <td>${escapeHtml(r.species || "")}</td>
          <td>${escapeHtml(r.conjugate || "")}</td>
          <td><a href="${r.link}" target="_blank" rel="noreferrer noopener">Link</a></td>
        </tr>`;
      })
      .join("");
    const tableEnd = `</tbody></table>`;

    res.type("text/html").send(header + tableHead + tableRows + tableEnd);
  } catch (e) {
    res
      .status(502)
      .type("text/plain")
      .send("Failed to render table.\n\n" + String(e));
  }
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ------------------------------ Server ------------------------------ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Playwright API listening on " + PORT);
});

