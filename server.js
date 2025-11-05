import express from "express";
import { chromium } from "playwright";

const app = express();

app.get("/", (req,res) => {
  res.type("text/plain").send("Antibody Playwright API is running. Try /search?vendor=BioLegend&target=CCR7&species=Human&laser=Blue");
});

app.get("/search", async (req, res) => {
  const vendorIn = (req.query.vendor || "").toLowerCase();
  const target = (req.query.target || "").trim();
  const species = (req.query.species || "Human").trim();
  const laserIn = (req.query.laser || "").toLowerCase();
  const override = req.query.override_url || "";

  const normVendor = v => v.includes("biolegend") ? "biolegend"
                     : v.includes("thermo") ? "thermo"
                     : v === "bd" || v.includes("biosciences") ? "bd"
                     : null;

  const normLaser = l => ({uv:"uv", violet:"violet", blue:"blue",
                           yg:"yg","yellow":"yg","yellow-green":"yg","yellow green":"yg","green":"yg", red:"red"})[l] || null;

  const vendor = normVendor(vendorIn);
  const laser = normLaser(laserIn);
  if (!vendor || !target || !species || !laser) {
    return res.status(400).json({ error: "bad_params" });
  }

  const URL_MAP = {
    biolegend: {
      blue:   `https://www.biolegend.com/en-us/search-results?ExcitationLaser=bluelaser&Keywords=${encodeURIComponent(target)}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
      uv:     `https://www.biolegend.com/en-us/search-results?ExcitationLaser=uvlaser&Keywords=${encodeURIComponent(target)}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
      violet: `https://www.biolegend.com/en-us/search-results?ExcitationLaser=violetlaser&Keywords=${encodeURIComponent(target)}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
      yg:     `https://www.biolegend.com/en-us/search-results?ExcitationLaser=yellowgreenlaser&Keywords=${encodeURIComponent(target)}&PageSize=100&Reactivity=${encodeURIComponent(species)}`,
      red:    `https://www.biolegend.com/en-us/search-results?ExcitationLaser=redlaser&Keywords=${encodeURIComponent(target)}&PageSize=100&Reactivity=${encodeURIComponent(species)}`
    },
    thermo: {
      blue:   `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/488+nm+(Blue)`,
      uv:     `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/355+nm+(UV)`,
      violet: `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/405+nm+(Violet)`,
      yg:     `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/561+nm+(Yellow-Green)`,
      red:    `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/633+nm+(Red)`
    },
    bd: {
      blue:   `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(target)}&speciesReactivity_facet_ss::%22${encodeURIComponent(species)}%22=%22${encodeURIComponent(species)}%22&applicationName_facet_ss::%22Flow%20cytrometry%22=%22Flow%20cytrometry%22&excitationSource_facet_s::%22Blue%20488%20nm%22=%22Blue%20488%20nm%22`.replace("cytrometry","cytometry"),
      uv:     `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(target)}&speciesReactivity_facet_ss::%22${encodeURIComponent(species)}%22=%22${encodeURIComponent(species)}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22UV%20Laser%22=%22UV%20Laser%22`,
      violet: `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(target)}&speciesReactivity_facet_ss::%22${encodeURIComponent(species)}%22=%22${encodeURIComponent(species)}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Violet%20405%20nm%22=%22Violet%20405%20nm%22`,
      yg:     `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(target)}&speciesReactivity_facet_ss::%22${encodeURIComponent(species)}%22=%22${encodeURIComponent(species)}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Yellow-Green%20561%20nm%22=%22Yellow-Green%20561%20nm%22`,
      red:    `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(target)}&speciesReactivity_facet_ss::%22${encodeURIComponent(species)}%22=%22${encodeURIComponent(species)}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Red%20640%20nm%22=%22Red%20640%20nm%22`
    }
  };

  const startUrl = override || URL_MAP[vendor][laser];

  const browser = await chromium.launch({
    args: ["--no-sandbox","--disable-setuid-sandbox"],
    headless: true
  });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const acceptCookies = async () => {
    const selectors = [
      '#onetrust-accept-btn-handler',
      'button#truste-consent-button',
      'button[aria-label*="Accept"]',
      'button:has-text("Accept All")',
      'button:has-text("I Accept")',
      'button:has-text("Got it")'
    ];
    for (const sel of selectors) {
      const btn = await page.$(sel);
      if (btn) { try { await btn.click({timeout: 1000}); await page.waitForTimeout(500); } catch {} }
    }
  };

  const goProductsTabIfAny = async () => {
    // Some sites have tabs: Products / Articles / etc.
    const tabSel = [
      'a[role="tab"]:has-text("Products")',
      'button[role="tab"]:has-text("Products")',
      'a:has-text("Products")'
    ];
    for (const sel of tabSel) {
      const el = await page.$(sel);
      if (el) { try { await el.click({timeout: 800}); await page.waitForTimeout(500); } catch {} }
    }
  };

  const autoScroll = async () => {
    for (let i=0;i<6;i++){
      await page.evaluate(() => window.scrollBy(0, window.innerHeight*1.2));
      await page.waitForTimeout(700);
    }
  };

  try {
    await page.goto(startUrl, { timeout: 60000, waitUntil: "domcontentloaded" });
    await acceptCookies();
    await goProductsTabIfAny();

    // Try to surface cards by waiting, scrolling, and clicking "Load more"
    const loadMoreSelectors = [
      'button:has-text("Load more")',
      'button:has-text("Load 25 more results")',
      'button:has-text("Show more")'
    ];

    // Wait for any plausible product container
    await page.waitForTimeout(1200);
    await autoScroll();

    for (let i=0;i<4;i++){
      let clicked = false;
      for (const lm of loadMoreSelectors) {
        const btn = await page.$(lm);
        if (btn) { try { await btn.click(); clicked = true; await page.waitForTimeout(1200); } catch {} }
      }
      if (!clicked) break;
      await autoScroll();
    }

    let rows = [];
    if (vendor === "biolegend") {
      // BioLegend product cards (support both legacy & new)
      await page.waitForSelector('div.product-cell, .c-product-card, .c-search-results__products', { timeout: 8000 }).catch(()=>{});
      rows = await page.$$eval('div.product-cell, .c-product-card', cards => cards.map(card => {
        const a = card.querySelector('a[itemprop="name"], a.c-product-card__title, a.product-name, a.product-title, a.card-title');
        const name = a ? a.textContent.trim().replace(/\s+/g," ") : null;
        const href = a ? a.getAttribute("href") : null;
        const link = href ? (href.startsWith("http") ? href : ("https://www.biolegend.com"+href)) : null;
        return name && link ? {vendor:"BioLegend", product_name:name, link} : null;
      }).filter(Boolean));
      // Fill target/species + conjugate from name
      rows = rows.map(r => ({
        ...r,
        target,
        species,
        conjugate: (() => {
          const i = r.product_name.toLowerCase().indexOf(" anti-");
          if (i > 0) return r.product_name.slice(0, i).trim();
          const parts = r.product_name.split(","); 
          return parts.length>1 ? parts[parts.length-1].trim() : r.product_name;
        })()
      }));
    }

    if (vendor === "thermo") {
      await page.waitForSelector('div.flex-container.product-info.ab-primary, .product-results, .search-results', { timeout: 8000 }).catch(()=>{});
      // click any "Load more"
      for (let i=0;i<3;i++){
        const btn = await page.$('button:has-text("Load 25 more results"), button:has-text("Load more")');
        if (!btn) break;
        await btn.click();
        await page.waitForTimeout(1000);
      }
      rows = await page.$$eval('div.flex-container.product-info.ab-primary', blocks => blocks.map(b => {
        const a = b.querySelector("a.product-desc, a.product-desc-new");
        const name = a ? a.textContent.trim().replace(/\s+/g," ") : null;
        const href = a ? a.getAttribute("href") : null;
        const link = href ? (href.startsWith("http") ? href : ("https://www.thermofisher.com"+href)) : null;
        const hasSpecies = !!b.querySelector('.item.species-item');
        return name && link ? {vendor:"Thermo Fisher", product_name:name, link, hasSpecies} : null;
      }).filter(Boolean));
      rows = rows.filter(r => r.hasSpecies).map(r => ({
        vendor: r.vendor,
        product_name: r.product_name,
        target,
        species,
        conjugate: ((m)=> m? m[1].trim(): r.product_name)(/\)\s*,\s*([^,]+)(?:,|$)/.exec(r.product_name)),
        link: r.link
      }));
    }

    if (vendor === "bd") {
      await page.waitForSelector('div.pdp-search-card__body, .pdp-search-card, a.card-title', { timeout: 10000 }).catch(()=>{});
      rows = await page.$$eval('div.pdp-search-card__body, .pdp-search-card', cards => cards.map(card => {
        const a = card.querySelector("a.card-title.pdp-search-card__body-title, a.card-title");
        const name = a ? a.textContent.trim().replace(/\s+/g," ") : null;
        const href = a ? a.getAttribute("href") : null;
        const link = href ? (href.startsWith("http") ? href : ("https://www.bdbiosciences.com"+href)) : null;
        return name && link ? {vendor:"BD Biosciences", product_name:name, link} : null;
      }).filter(Boolean));
      rows = rows.map(r => ({
        ...r,
        target,
        species,
        conjugate: ((m)=> m? m[1].trim(): r.product_name)(/\)\s*(.*)$/.exec(r.product_name))
      }));
    }

    // domain guard + dedupe
    const domainOK = v => v==="BioLegend" ? "biolegend.com" : v==="Thermo Fisher" ? "thermofisher.com" : "bdbiosciences.com";
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
    res.status(502).json({ error: "fetch_or_parse_failed", detail: String(e) });
  } finally {
    await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Playwright API listening on " + PORT));


