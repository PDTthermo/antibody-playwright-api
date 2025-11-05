import express from "express";
import { chromium } from "playwright";

const app = express();

// Optional friendly homepage
app.get("/", (req, res) => {
  res
    .type("text/plain")
    .send(
      "Antibody Playwright API is running.\nTry: /search?vendor=BioLegend&target=CCR7&species=Human&laser=Blue"
    );
});

// ----------- Helpers -----------
const normVendor = (v) =>
  v.includes("biolegend")
    ? "biolegend"
    : v.includes("thermo")
    ? "thermo"
    : v === "bd" || v.includes("biosciences")
    ? "bd"
    : null;

const normLaser = (l) => {
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
        await page.waitForTimeout(500);
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
        await page.waitForTimeout(600);
      } catch {}
    }
  }
};

const autoScroll = async (page, passes = 6) => {
  for (let i = 0; i < passes; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
    await page.waitForTimeout(800);
  }
};

const clickLoadMoreIfAny = async (page, attempts = 5) => {
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
          await btn.click();
          clicked = true;
          await page.waitForTimeout(1200);
        } catch {}
      }
    }
    if (!clicked) break;
    await autoScroll(page, 2);
  }
};

// ----------- URL Map -----------
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

// ----------- Route -----------
app.get("/search", async (req, res) => {
  const vendorIn = (req.query.vendor || "").toLowerCase();
  const target = (req.query.target || "").trim();
  const species = (req.query.species || "Human").trim();
  const laserIn = (req.query.laser || "").toLowerCase();
  const override = req.query.override_url || "";

  const vendor = normVendor(vendorIn);
  const laser = normLaser(laserIn);
  if (!vendor || !target || !species || !laser) {
    return res.status(400).json({ error: "bad_params" });
  }

  const startUrl = override || URL_MAP[vendor][laser](target, species);

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  try {
    await page.goto(startUrl, {
      timeout: 60000,
      waitUntil: "domcontentloaded",
    });

    // General prep
    await acceptCookies(page);
    await goProductsTabIfAny(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await autoScroll(page, 8);
    await clickLoadMoreIfAny(page, 5);

    let rows = [];

    // ------------ BIOLEGEND ------------
    if (vendor === "biolegend") {
      const cardsSel =
        "div.product-cell, .c-product-card, article.c-product-card, .c-search-results__products .c-product-card";
      await page.waitForSelector(cardsSel, { timeout: 12000 }).catch(() => {});
      rows = await page.$$eval(cardsSel, (cards) =>
        cards
          .map((card) => {
            const a =
              card.querySelector(
                'a[itemprop="name"], a.c-product-card__title, a.product-name, a.product-title, a.card-title, a[href*="/products/"]'
              ) || null;
            const name = a ? a.textContent.trim().replace(/\s+/g, " ") : null;
            let href = a ? a.getAttribute("href") : null;
            if (href && !href.startsWith("http"))
              href = "https://www.biolegend.com" + href;
            if (name && href && href.includes("biolegend.com")) {
              return { vendor: "BioLegend", product_name: name, link: href };
            }
            const alt =
              card.querySelector("[data-product-name], [title]") || null;
            if (alt) {
              const txt =
                alt.getAttribute("data-product-name") ||
                alt.getAttribute("title") ||
                "";
              if (txt.trim() && href && href.includes("biolegend.com")) {
                return {
                  vendor: "BioLegend",
                  product_name: txt.trim(),
                  link: href,
                };
              }
            }
            return null;
          })
          .filter(Boolean)
      );

      rows = rows.map((r) => ({
        ...r,
        target,
        species,
        conjugate: (() => {
          const i = r.product_name.toLowerCase().indexOf(" anti-");
          if (i > 0) return r.product_name.slice(0, i).trim();
          const parts = r.product_name.split(",");
          return parts.length > 1 ? parts[parts.length - 1].trim() : r.product_name;
        })(),
      }));
    }

    // ------------ THERMO (WORKING) ------------
    if (vendor === "thermo") {
      await page
        .waitForSelector(
          "div.flex-container.product-info.ab-primary, .product-results, .search-results",
          { timeout: 8000 }
        )
        .catch(() => {});
      // Load more if present
      for (let i = 0; i < 3; i++) {
        const btn = await page.$(
          'button:has-text("Load 25 more results"), button:has-text("Load more")'
        );
        if (!btn) break;
        try {
          await btn.click();
        } catch {}
        await page.waitForTimeout(1000);
      }

      rows = await page.$$eval(
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
    }

    // ------------ BD ------------
    if (vendor === "bd") {
      await page
        .waitForLoadState("networkidle", { timeout: 25000 })
        .catch(() => {});
      await page
        .waitForSelector(
          "div.pdp-search-card__body, .pdp-search-card, a.card-title",
          { timeout: 15000 }
        )
        .catch(() => {});
      await clickLoadMoreIfAny(page, 5);

      const bdCardsSel =
        "div.pdp-search-card__body, .pdp-search-card, article.pdp-search-card";
      rows = await page.$$eval(bdCardsSel, (cards) =>
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

      rows = rows.map((r) => ({
        ...r,
        target,
        species,
        conjugate: ((m) => (m ? m[1].trim() : r.product_name))(
          /\)\s*(.*)$/.exec(r.product_name)
        ),
      }));
    }

    // Domain guard + dedupe
    const domainOK = (v) =>
      v === "BioLegend"
        ? "biolegend.com"
        : v === "Thermo Fisher"
        ? "thermofisher.com"
        : "bdbiosciences.com";
    const seen = new Set();
    const final = [];
    for (const r of rows) {
      if (!r.link || !r.link.includes(domainOK(r.vendor))) continue;
      const key = `${r.vendor}|${r.product_name}|${r.link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      final.push(r);
    }

    res.json({ rows: final });
  } catch (e) {
    res
      .status(502)
      .json({ error: "fetch_or_parse_failed", detail: String(e) });
  } finally {
    await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Playwright API listening on " + PORT)
);
