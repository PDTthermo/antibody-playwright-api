import express from "express";
import { chromium } from "playwright";

const app = express();

/* ----------------------------- Small homepage ----------------------------- */
app.get("/", (req, res) => {
  res
    .type("text/plain")
    .send(
      [
        "Antibody Playwright API is running.",
        "JSON: /search?vendor=BioLegend&target=CCR7&species=Human&laser=Blue",
        "ALL vendors: /search?vendor=All&target=CD3&species=Human&laser=Red&debug=1",
        "TABLE: /table?vendor=BioLegend&target=CCR7&species=Human&laser=Blue",
      ].join("\n")
    );
});

/* --------------------------------- Helpers -------------------------------- */
const normVendor = (v) => {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "all") return "all";
  if (s.includes("biolegend")) return "biolegend";
  if (s.includes("thermo")) return "thermo";
  if (s === "bd" || s.includes("biosciences")) return "bd";
  return null;
};

const normLaser = (l) => {
  const s = String(l || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "uv") return "uv";
  if (s.includes("violet") || s === "v") return "violet";
  if (s === "yg" || s.includes("yellow") || s.includes("green")) return "yg";
  if (s.includes("red") || s.includes("ir")) return "red";
  if (s.includes("blue") || s === "b") return "blue";
  return null;
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
  ];
  for (const sel of selectors) {
    const btn = await page.$(sel);
    if (btn) {
      try {
        await btn.click({ timeout: 1200 });
        await page.waitForTimeout(400);
      } catch {}
    }
  }
};

const goProductsTabIfAny = async (page) => {
  const tabSel = [
    'a[role="tab"]:has-text("Products")',
    'button[role="tab"]:has-text("Products")',
    'a:has-text("Products")',
  ];
  for (const sel of tabSel) {
    const el = await page.$(sel);
    if (el) {
      try {
        await el.click({ timeout: 1200 });
        await page.waitForTimeout(500);
      } catch {}
    }
  }
};

const autoScroll = async (page, passes = 6) => {
  for (let i = 0; i < passes; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
    await page.waitForTimeout(600);
  }
};

const clickLoadMoreIfAny = async (page, attempts = 6) => {
  const loadMoreSelectors = [
    'button:has-text("Load more")',
    'button:has-text("Load 25 more results")',
    'button:has-text("Show more")',
  ];
  for (let i = 0; i < attempts; i++) {
    let clicked = false;
    for (const lm of loadMoreSelectors) {
      const btn = await page.$(lm);
      if (btn) {
        try {
          await Promise.all([
            page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
            btn.click(),
          ]);
          clicked = true;
          await page.waitForTimeout(900);
        } catch {}
      }
    }
    if (!clicked) break;
    await autoScroll(page, 2);
  }
};

/* -------------------------------- URL builders ---------------------------- */
const URL_MAP = {
  biolegend: {
    blue: (t, s) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=bluelaser&Keywords=${encodeURIComponent(
        t
      )}&PageSize=100&Reactivity=${encodeURIComponent(s)}`,
    uv: (t, s) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=uvlaser&Keywords=${encodeURIComponent(
        t
      )}&PageSize=100&Reactivity=${encodeURIComponent(s)}`,
    violet: (t, s) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=violetlaser&Keywords=${encodeURIComponent(
        t
      )}&PageSize=100&Reactivity=${encodeURIComponent(s)}`,
    yg: (t, s) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=yellowgreenlaser&Keywords=${encodeURIComponent(
        t
      )}&PageSize=100&Reactivity=${encodeURIComponent(s)}`,
    red: (t, s) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=redlaser&Keywords=${encodeURIComponent(
        t
      )}&PageSize=100&Reactivity=${encodeURIComponent(s)}`,
  },
  thermo: {
    blue: (t, s) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        t
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        s
      )}/compatibility/488+nm+(Blue)`,
    uv: (t, s) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        t
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        s
      )}/compatibility/355+nm+(UV)`,
    violet: (t, s) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        t
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        s
      )}/compatibility/405+nm+(Violet)`,
    yg: (t, s) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        t
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        s
      )}/compatibility/561+nm+(Yellow-Green)`,
    red: (t, s) =>
      `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(
        t
      )}/filter/application/Flow+Cytometry/species/${encodeURIComponent(
        s
      )}/compatibility/633+nm+(Red)`,
  },
  bd: {
    blue: (t, s) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        t
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        s
      )}%22=%22${encodeURIComponent(
        s
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Blue%20488%20nm%22=%22Blue%20488%20nm%22`,
    uv: (t, s) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        t
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        s
      )}%22=%22${encodeURIComponent(
        s
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22UV%20Laser%22=%22UV%20Laser%22`,
    violet: (t, s) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        t
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        s
      )}%22=%22${encodeURIComponent(
        s
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Violet%20405%20nm%22=%22Violet%20405%20nm%22`,
    yg: (t, s) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        t
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        s
      )}%22=%22${encodeURIComponent(
        s
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Yellow-Green%20561%20nm%22=%22Yellow-Green%20561%20nm%22`,
    red: (t, s) =>
      `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(
        t
      )}&speciesReactivity_facet_ss::%22${encodeURIComponent(
        s
      )}%22=%22${encodeURIComponent(
        s
      )}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Red%20627-640%20nm%22=%22Red%20627-640%20nm%22`,
  },
};

/* --------------------- BioLegend laser synonyms candidates --------------------- */
const LASER_ALIASES = {
  biolegend: {
    blue: ["bluelaser"],
    violet: ["violetlaser", "uvlaser"],
    uv: ["uvlaser", "violetlaser"],
    yg: ["yellowgreenlaser", "greenlaser"],
    red: ["redlaser"],
  },
};
const getBioLegendUrls = (target, species, laser) => {
  const c = LASER_ALIASES.biolegend[laser] || ["bluelaser"];
  return c.map(
    (val) =>
      `https://www.biolegend.com/en-us/search-results?ExcitationLaser=${encodeURIComponent(
        val
      )}&Keywords=${encodeURIComponent(target)}&PageSize=100&Reactivity=${encodeURIComponent(
        species
      )}`
  );
};

/* ------------------------- Vendor-specific scrapers ------------------------- */
async function scrapeThermo(page, startUrl, target, species) {
  await page.goto(startUrl, { timeout: 60000, waitUntil: "domcontentloaded" });
  await acceptCookies(page);
  await goProductsTabIfAny(page);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
  await autoScroll(page, 6);
  await clickLoadMoreIfAny(page, 10);

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
            ? {
                vendor: "Thermo Fisher",
                product_name: name,
                link,
                hasSpecies,
              }
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

async function scrapeBD(page, startUrl, target, species) {
  await page.goto(startUrl, { timeout: 60000, waitUntil: "domcontentloaded" });
  await acceptCookies(page);
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  await page.waitForSelector(
    "div.pdp-search-card__body, .pdp-search-card, a.card-title",
    { timeout: 15000 }
  ).catch(() => {});
  await autoScroll(page, 4);
  await clickLoadMoreIfAny(page, 6);

  const collect = async () =>
    page.$$eval(
      "div.pdp-search-card__body, .pdp-search-card, article.pdp-search-card",
      (cards) =>
        cards
          .map((card) => {
            const a =
              card.querySelector(
                "a.card-title.pdp-search-card__body-title, a.card-title, a[href*='/products/'], a[href*='/en-us/products/']"
              ) || null;
            const name = a ? a.textContent.trim().replace(/\s+/g, " ") : null;
            let href = a ? a.getAttribute("href") : null;
            if (href && !href.startsWith("http"))
              href = "https://www.bdbiosciences.com" + href;
            return name && href && href.includes("bdbiosciences.com")
              ? { vendor: "BD Biosciences", product_name: name, link: href }
              : null;
          })
          .filter(Boolean)
    );

  let rows = await collect();

  // ---- Numbered/Next pagination (up to 5 next pages) ----
  for (let p = 0; p < 5; p++) {
    const nextSel = 'a[aria-label="Next"], a.pagination__next, a[rel="next"]';
    const nextLink = await page.$(nextSel);
    if (!nextLink) break;
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }),
        nextLink.click(),
      ]);
      await autoScroll(page, 3);
      await clickLoadMoreIfAny(page, 3);
      const more = await collect();
      const before = rows.length;
      rows.push(...more);
      if (rows.length === before) break;
    } catch {}
  }

  rows = rows.map((r) => ({
    ...r,
    target,
    species,
    conjugate: ((m) => (m ? m[1].trim() : r.product_name))(/\)\s*(.*)$/.exec(r.product_name)),
  }));

  return rows;
}

async function scrapeBioLegend(page, target, species, laser) {
  // Stealth + UA
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const tryUrls = getBioLegendUrls(target, species, laser);
  let anchors = [];
  let tried = [];
  let pageCount = 0;

  const collectAnchors = async () => {
    // Primary structure
    let arr = await page.$$eval("li.row.list h2 a[itemprop='name']", (els) =>
      els.map((a) => {
        const name = (a.textContent || "").trim().replace(/\s+/g, " ");
        let href = a.getAttribute("href") || "";
        if (href && !/^https?:\/\//i.test(href)) {
          href = "https://www.biolegend.com" + (href.startsWith("/") ? href : "/" + href);
        }
        return { name, href };
      })
    );
    if (arr.length) return arr;

    // Fallbacks
    arr = await page.$$eval("li.row.list a[itemprop='name']", (els) =>
      els.map((a) => {
        const name = (a.textContent || "").trim().replace(/\s+/g, " ");
        let href = a.getAttribute("href") || "";
        if (href && !/^https?:\/\//i.test(href)) {
          href = "https://www.biolegend.com" + (href.startsWith("/") ? href : "/" + href);
        }
        return { name, href };
      })
    );
    if (arr.length) return arr;

    arr = await page.$$eval("a[href*='/products/']", (els) =>
      els
        .map((a) => {
          const name = (a.textContent || "").trim().replace(/\s+/g, " ");
          let href = a.getAttribute("href") || "";
          if (href && !/^https?:\/\//i.test(href)) {
            href = "https://www.biolegend.com" + (href.startsWith("/") ? href : "/" + href);
          }
          return { name, href };
        })
        .filter((x) => x.name && /biolegend\.com/i.test(x.href))
    );
    return arr;
  };

  const fetchMorePagesIfAny = async (currentUrl, have, maxPages = 5) => {
    const out = [...have];
    try {
      const urlObj = new URL(currentUrl);
      if (!urlObj.searchParams.get("PageSize")) urlObj.searchParams.set("PageSize", "100");
      for (let p = 2; p <= maxPages; p++) {
        urlObj.searchParams.set("Page", String(p));
        const nextUrl = urlObj.toString();

        await page.goto(nextUrl, { waitUntil: "networkidle", timeout: 60000 });
        await acceptCookies(page);
        await page.waitForTimeout(500);
        await autoScroll(page, 3);
        pageCount++;

        const more = await collectAnchors();
        if (!more || more.length === 0) break;
        const before = out.length;
        out.push(...more);
        if (out.length === before) break;
      }
    } catch {}
    return out;
  };

  for (const url of tryUrls) {
    tried.push(url);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await acceptCookies(page);
    await page.waitForTimeout(700);
    await autoScroll(page, 5);
    pageCount++;

    anchors = await collectAnchors();
    if (anchors && anchors.length) {
      anchors = await fetchMorePagesIfAny(url, anchors, 5);
      break;
    }
  }

  const rows = (anchors || []).map(({ name, href }) => {
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

  return { rows, debug: { tried, pageCount, rowsFound: rows.length } };
}

/* ---------------------------------- Route(s) --------------------------------- */
app.get("/search", async (req, res) => {
  const vendorIn = req.query.vendor || "";
  const target = (req.query.target || "").trim();
  const species = (req.query.species || "Human").trim();
  const laserIn = req.query.laser || "";
  const override = req.query.override_url || "";
  const debugWanted = (req.query.debug || "") === "1";

  const vendor = normVendor(vendorIn);
  const laser = normLaser(laserIn);

  if (!vendor || !target || !species || !laser) {
    return res.status(400).json({ error: "bad_params" });
  }

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const domainOK = (v) =>
    v === "BioLegend" ? "biolegend.com" : v === "Thermo Fisher" ? "thermofisher.com" : "bdbiosciences.com";

  try {
    let payload;
    if (vendor === "all") {
      // Run each vendor sequentially (simpler on free tiers)
      const thermoUrl = URL_MAP.thermo[laser](target, species);
      const bdUrl = URL_MAP.bd[laser](target, species);

      const thermoRows = await scrapeThermo(page, thermoUrl, target, species).catch(() => []);
      const bdRows = await scrapeBD(page, bdUrl, target, species).catch(() => []);
      const bl = await scrapeBioLegend(page, target, species, laser).catch(() => ({ rows: [], debug: {} }));

      let rows = [...thermoRows, ...bdRows, ...bl.rows];

      // dedupe
      const seen = new Set();
      const final = [];
      for (const r of rows) {
        if (!r.link || !r.link.includes(domainOK(r.vendor))) continue;
        const key = `${r.vendor}|${r.product_name}|${r.link}`;
        if (seen.has(key)) continue;
        seen.add(key);
        final.push(r);
      }
      payload = debugWanted
        ? { rows: final, debug: { thermoUrl, bdUrl, bioLegend: bl.debug } }
        : { rows: final };
    } else if (vendor === "thermo") {
      const startUrl = override || URL_MAP.thermo[laser](target, species);
      const rows = await scrapeThermo(page, startUrl, target, species);
      payload = debugWanted ? { url: startUrl, rows } : { rows };
    } else if (vendor === "bd") {
      const startUrl = override || URL_MAP.bd[laser](target, species);
      const rows = await scrapeBD(page, startUrl, target, species);
      payload = debugWanted ? { url: startUrl, rows } : { rows };
    } else {
      // biolegend
      const bl = await scrapeBioLegend(page, target, species, laser);
      payload = debugWanted ? { rows: bl.rows, debug: bl.debug } : { rows: bl.rows };
    }

    return res.json(payload);
  } catch (e) {
    return res.status(502).json({ error: "fetch_or_parse_failed", detail: String(e) });
  } finally {
    await browser.close();
  }
});

/* ------------------------------ Simple HTML table --------------------------- */
app.get("/table", async (req, res) => {
  const qs = new URLSearchParams({
    vendor: String(req.query.vendor || ""),
    target: String(req.query.target || ""),
    species: String(req.query.species || ""),
    laser: String(req.query.laser || ""),
  });
  const base = `${req.protocol}://${req.get("host")}`;
  const url = `${base}/search?${qs.toString()}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();

    const rows = Array.isArray(data.rows) ? data.rows : [];
    const table =
      `<table border="1" cellpadding="6" cellspacing="0">
        <thead>
          <tr><th>Vendor</th><th>Product Name</th><th>Target</th><th>Species</th><th>Conjugate</th><th>Link</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr>
                  <td>${r.vendor || ""}</td>
                  <td>${r.product_name || ""}</td>
                  <td>${r.target || ""}</td>
                  <td>${r.species || ""}</td>
                  <td>${r.conjugate || ""}</td>
                  <td><a href="${r.link || "#"}" target="_blank">Product</a></td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>`;

    res.type("text/html").send(
      `<h3>Results for ${req.query.vendor || ""} / ${req.query.target || ""} / ${
        req.query.species || ""
      } / ${req.query.laser || ""}</h3>${table}`
    );
  } catch (e) {
    res.status(500).type("text/plain").send("Failed to render table: " + String(e));
  }
});

/* --------------------------------- Boot --------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Playwright API listening on " + PORT));




