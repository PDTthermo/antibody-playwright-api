import express from "express";
import { chromium } from "playwright";

const app = express();

/* ---------------------------- Friendly homepage ---------------------------- */
app.get("/", (req, res) => {
  res
    .type("text/plain")
    .send(
      "Antibody Playwright API is running.\n" +
      "Examples:\n" +
      " /search?vendor=BioLegend&target=CCR7&species=Human&laser=Blue&limit=30&offset=0\n" +
      " /json?vendor=BD&target=CD3&species=Human&laser=Red\n" +
      " /table?vendor=Thermo&target=CD4&species=Mouse&laser=Violet"
    );
});

/* --------------------------------- Helpers -------------------------------- */
const normVendor = (vIn) => {
  const v = (vIn || "").toLowerCase();
  if (v.includes("biolegend")) return "biolegend";
  if (v.includes("thermo")) return "thermo";
  if (v === "bd" || v.includes("biosciences")) return "bd";
  return null;
};

const normLaser = (lIn) => {
  const l = (lIn || "").toLowerCase();
  const map = {
    uv: "uv",
    violet: "violet",
    blue: "blue",
    yg: "yg",
    "yellow-green": "yg",
    "yellow green": "yg",
    yellow: "yg",
    green: "yg",
    red: "red",
  };
  return map[l] || null;
};

const acceptCookies = async (page) => {
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
  for (const sel of sels) {
    const btn = await page.$(sel);
    if (btn) {
      try { await btn.click({ timeout: 1200 }); await page.waitForTimeout(500); } catch {}
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
      try { await el.click({ timeout: 1200 }); await page.waitForTimeout(600); } catch {}
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
        try { await btn.click(); clicked = true; await page.waitForTimeout(1200); } catch {}
      }
    }
    if (!clicked) break;
    await autoScroll(page, 2);
  }
};

/* -------------------------------- URL MAPS -------------------------------- */
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

/* ---------------------------------- /search --------------------------------- */
app.get("/search", async (req, res) => {
  // Params
  const vendorIn = (req.query.vendor || "").toLowerCase();
  const target = (req.query.target || "").trim();
  const species = (req.query.species || "Human").trim();
  const laserIn = (req.query.laser || "").toLowerCase();
  const override = req.query.override_url || "";
  const debugWanted = (req.query.debug || "") === "1";

  const vendor = normVendor(vendorIn);
  const laser = normLaser(laserIn);

  // Pagination knobs
  const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));
  const offset = Math.max(0, Number(req.query.offset || 0));

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
    await page.goto(startUrl, { timeout: 60000, waitUntil: "domcontentloaded" });
    await acceptCookies(page);
    await goProductsTabIfAny(page);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await autoScroll(page, 8);
    await clickLoadMoreIfAny(page, 5);

    let rows = [];

    /* ---------------------------- BIOLEGEND ---------------------------- */
    if (vendor === "biolegend") {
      await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });

      await page.goto(startUrl, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
      await acceptCookies(page);
      await page.waitForTimeout(800);
      await autoScroll(page, 6);
      await clickLoadMoreIfAny(page, 5);

      const counts = await page.evaluate(() => ({
        primary: document.querySelectorAll("li.row.list h2 a[itemprop='name']").length,
        liName: document.querySelectorAll("li.row.list a[itemprop='name']").length,
        anyProducts: document.querySelectorAll("a[href*='/products/']").length,
      }));

      let anchors = [];
      if (counts.primary > 0) {
        anchors = await page.$$eval("li.row.list h2 a[itemprop='name']", (els) =>
          els.map((a) => {
            const name = (a.textContent || "").trim().replace(/\s+/g, " ");
            let href = a.getAttribute("href") || "";
            if (href && !/^https?:\/\//i.test(href)) {
              href = "https://www.biolegend.com" + (href.startsWith("/") ? href : "/" + href);
            }
            return { name, href };
          })
        );
      } else if (counts.liName > 0) {
        anchors = await page.$$eval("li.row.list a[itemprop='name']", (els) =>
          els.map((a) => {
            const name = (a.textContent || "").trim().replace(/\s+/g, " ");
            let href = a.getAttribute("href") || "";
            if (href && !/^https?:\/\//i.test(href)) {
              href = "https://www.biolegend.com" + (href.startsWith("/") ? href : "/" + href);
            }
            return { name, href };
          })
        );
      } else if (counts.anyProducts > 0) {
        anchors = await page.$$eval("a[href*='/products/']", (els) =>
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
      }

      rows = (anchors || []).map(({ name, href }) => {
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

      if (debugWanted) {
        req._debug_vendor = { biolegend: { counts, rowsFound: rows.length } };
      }
    }

    /* ---------------------------- THERMO ------------------------------- */
    if (vendor === "thermo") {
      await page
        .waitForSelector("div.flex-container.product-info.ab-primary, .product-results, .search-results", { timeout: 8000 })
        .catch(() => {});
      for (let i = 0; i < 3; i++) {
        const btn = await page.$('button:has-text("Load 25 more results"), button:has-text("Load more")');
        if (!btn) break;
        try { await btn.click(); } catch {}
        await page.waitForTimeout(1000);
      }

      rows = await page.$$eval("div.flex-container.product-info.ab-primary", (blocks) =>
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
          conjugate: ((m) => (m ? m[1].trim() : r.product_name))(/\)\s*,\s*([^,]+)(?:,|$)/.exec(r.product_name)),
          link: r.link,
        }));
    }

    /* -------------------------------- BD -------------------------------- */
    if (vendor === "bd") {
      await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
      await page
        .waitForSelector("div.pdp-search-card__body, .pdp-search-card, a.card-title", { timeout: 15000 })
        .catch(() => {});
      await clickLoadMoreIfAny(page, 5);

      const bdCardsSel = "div.pdp-search-card__body, .pdp-search-card, article.pdp-search-card";
      rows = await page.$$eval(bdCardsSel, (cards) =>
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
    }

    /* ------------------- Domain Guard + Dedup + Pagination ------------------ */
    const domainOK = (v) =>
      v === "BioLegend" ? "biolegend.com" : v === "Thermo Fisher" ? "thermofisher.com" : "bdbiosciences.com";

    const seen = new Set();
    let final = [];
    for (const r of rows) {
      if (!r.link || !r.link.includes(domainOK(r.vendor))) continue;
      const key = `${r.vendor}|${(r.target || "").toUpperCase()}|${(r.species || "").toUpperCase()}|${(r.conjugate || "").toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      final.push(r);
    }

    const total = final.length;
    final = final.slice(offset, offset + limit);

    const debug = debugWanted
      ? { url: startUrl, total, limit, offset, vendorDebug: req._debug_vendor || null }
      : undefined;

    return res.json(
      debugWanted
        ? { rows: final, total, limit, offset, debug }
        : { rows: final, total, limit, offset }
    );
  } catch (e) {
    return res.status(502).json({ error: "fetch_or_parse_failed", detail: String(e) });
  } finally {
    await browser.close();
  }
});

/* ------------------------------ JSON facade ------------------------------- */
app.get("/json", async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get("host")}`;
    const qs = new URLSearchParams({
      vendor: String(req.query.vendor || ""),
      target: String(req.query.target || ""),
      species: String(req.query.species || ""),
      laser: String(req.query.laser || ""),
      limit: String(req.query.limit || "30"),
      offset: String(req.query.offset || "0"),
      debug: String(req.query.debug || ""),
    });
    const resp = await fetch(`${base}/search?${qs.toString()}`);
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "json_facade_failed", detail: String(e) });
  }
});

/* ------------------------- Numbered HTML table view ------------------------ */
app.get("/table", async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get("host")}`;
    const qs = new URLSearchParams({
      vendor: String(req.query.vendor || ""),
      target: String(req.query.target || ""),
      species: String(req.query.species || ""),
      laser: String(req.query.laser || ""),
      limit: String(req.query.limit || "50"),
      offset: String(req.query.offset || "0"),
    });
    const resp = await fetch(`${base}/json?${qs.toString()}`);
    const data = await resp.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const total = Number(data.total || rows.length);
    const limit = Number(data.limit || rows.length);
    const offset = Number(data.offset || 0);

    const grouped = {};
    for (const r of rows) {
      const v = r.vendor || "Unknown Vendor";
      if (!grouped[v]) grouped[v] = [];
      grouped[v].push(r);
    }

    let html = `<h2>Results for ${req.query.target || ""} (${req.query.laser || ""}) — showing ${rows.length} of ${total} (limit=${limit}, offset=${offset})</h2>`;
    for (const [vendor, list] of Object.entries(grouped)) {
      html += `<h3>${vendor} (${list.length} in page)</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="margin-bottom:20px;">
        <thead>
          <tr>
            <th>#</th>
            <th>Product Name</th>
            <th>Target</th>
            <th>Species</th>
            <th>Conjugate</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          ${list
            .map(
              (r, i) =>
                `<tr>
                  <td>${i + 1 + offset}</td>
                  <td>${(r.product_name || "").replace(/</g, "&lt;")}</td>
                  <td>${(r.target || "").replace(/</g, "&lt;")}</td>
                  <td>${(r.species || "").replace(/</g, "&lt;")}</td>
                  <td>${(r.conjugate || "").replace(/</g, "&lt;")}</td>
                  <td><a href="${r.link}" target="_blank">View</a></td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
    }

    const baseLink = `${req.path}?vendor=${encodeURIComponent(String(req.query.vendor||""))}&target=${encodeURIComponent(String(req.query.target||""))}&species=${encodeURIComponent(String(req.query.species||""))}&laser=${encodeURIComponent(String(req.query.laser||""))}&limit=${limit}`;
    const prev = Math.max(0, offset - limit);
    const next = offset + limit < total ? offset + limit : null;
    html += `<div style="margin:10px 0;">
      ${offset > 0 ? `<a href="${baseLink}&offset=${prev}">Prev</a>` : ""}
      ${next !== null ? ` &nbsp; <a href="${baseLink}&offset=${next}">Next</a>` : ""}
    </div>`;

    res.type("text/html").send(html);
  } catch (e) {
    res.status(500).type("text/plain").send("Failed to render table: " + String(e));
  }
});

/* --------------------------------- Boot ----------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Playwright API listening on " + PORT));
