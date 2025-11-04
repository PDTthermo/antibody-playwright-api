import express from "express";
import { chromium } from "playwright";

const app = express();
app.get("/search", async (req, res) => {
  const vendorIn = (req.query.vendor || "").toLowerCase();
  const target = (req.query.target || "").trim();
  const species = (req.query.species || "Human").trim();
  const laserIn = (req.query.laser || "").toLowerCase();
  const override = req.query.override_url || "";

  const normVendor = v => v.includes("biolegend") ? "biolegend" :
                          v.includes("thermo") ? "thermo" :
                          v === "bd" || v.includes("biosciences") ? "bd" : null;

  const normLaser = l => ({"uv":"uv","violet":"violet","blue":"blue",
                           "yg":"yg","yellow":"yg","yellow-green":"yg","yellow green":"yg",
                           "green":"yg","red":"red"})[l] || null;

  const vendor = normVendor(vendorIn);
  const laser = normLaser(laserIn);
  if (!vendor || !target || !species || !laser) {
    return res.status(400).json({ error: "bad_params" });
  }

  // URL map from your examples (we’ll only use as default; override_url takes precedence)
  const URL_MAP = {
    biolegend: {
      blue:   `https://www.biolegend.com/en-us/search-results?ExcitationLaser=bluelaser&Keywords=${encodeURIComponent(target)}&PageSize=25&Reactivity=${encodeURIComponent(species)}`,
      uv:     `https://www.biolegend.com/en-us/search-results?ExcitationLaser=uvlaser&Keywords=${encodeURIComponent(target)}&PageSize=25&Reactivity=${encodeURIComponent(species)}`,
      violet: `https://www.biolegend.com/en-us/search-results?ExcitationLaser=violetlaser&Keywords=${encodeURIComponent(target)}&PageSize=25&Reactivity=${encodeURIComponent(species)}`,
      yg:     `https://www.biolegend.com/en-us/search-results?ExcitationLaser=yellowgreenlaser&Keywords=${encodeURIComponent(target)}&PageSize=25&Reactivity=${encodeURIComponent(species)}`,
      red:    `https://www.biolegend.com/en-us/search-results?ExcitationLaser=redlaser&Keywords=${encodeURIComponent(target)}&PageSize=25&Reactivity=${encodeURIComponent(species)}`
    },
    thermo: {
      blue:   `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/488+nm+(Blue)`,
      uv:     `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/355+nm+(UV)`,
      violet: `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/405+nm+(Violet)`,
      yg:     `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/561+nm+(Yellow-Green)`,
      red:    `https://www.thermofisher.com/antibody/primary/query/${encodeURIComponent(target)}/filter/application/Flow+Cytometry/species/${encodeURIComponent(species)}/compatibility/633+nm+(Red)`
    },
    bd: {
      blue:   `https://www.bdbiosciences.com/en-us/search-results?searchKey=${encodeURIComponent(target)}&speciesReactivity_facet_ss::%22${encodeURIComponent(species)}%22=%22${encodeURIComponent(species)}%22&applicationName_facet_ss::%22Flow%20cytometry%22=%22Flow%20cytometry%22&excitationSource_facet_s::%22Blue%20488%20nm%22=%22Blue%20488%20nm%22`,
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

  try {
    await page.goto(startUrl, { timeout: 45000, waitUntil: "domcontentloaded" });

    // Vendor-specific waits + extraction
    let rows = [];
    if (vendor === "biolegend") {
      await page.waitForSelector("div.product-cell, .c-product-card", { timeout: 15000 }).catch(()=>{});
      // auto-load more (if button present) up to 4 times
      for (let i=0;i<4;i++){
        const btn = await page.$('button:has-text("Load more")');
        if (!btn) break;
        await btn.click();
        await page.waitForTimeout(1200);
      }
      rows = await page.$$eval("div.product-cell, .c-product-card", cards => cards.map(card => {
        const a = card.querySelector('a[itemprop="name"], a.c-product-card__title, a.product-name, a.product-title');
        const name = a ? a.textContent.trim().replace(/\s+/g," ") : null;
        const href = a ? a.getAttribute("href") : null;
        const link = href ? (href.startsWith("http") ? href : ("https://www.biolegend.com"+href)) : null;
        // species often in title ("anti-human") or tags
        const html = card.innerText || "";
        const speciesGuess = /anti-([\w\s]+)/i.test(html) ? /anti-([\w\s]+)/i.exec(html)[1].trim() : null;
        return name && link ? {vendor:"BioLegend", product_name:name, target:null, species:speciesGuess, conjugate:null, link} : null;
      }).filter(Boolean));
      // post-parse: fill target & species & conjugate
      rows = rows.map(r => ({
        ...r,
        target,
        species,
        conjugate: (() => {
          const m = r.product_name.toLowerCase().indexOf(" anti-");
          if (m > 0) return r.product_name.slice(0, m).trim();
          const parts = r.product_name.split(","); 
          return parts.length>1 ? parts[parts.length-1].trim() : r.product_name;
        })()
      }));
    }

    if (vendor === "thermo") {
      await page.waitForSelector("div.flex-container.product-info.ab-primary", { timeout: 15000 }).catch(()=>{});
      // load more if a button exists
      for (let i=0;i<4;i++){
        const btn = await page.$('button:has-text("Load 25 more results"), button:has-text("Load more")');
        if (!btn) break;
        await btn.click();
        await page.waitForTimeout(1200);
      }
      rows = await page.$$eval("div.flex-container.product-info.ab-primary", blocks => blocks.map(b => {
        const a = b.querySelector("a.product-desc, a.product-desc-new");
        const name = a ? a.textContent.trim().replace(/\s+/g," ") : null;
        const href = a ? a.getAttribute("href") : null;
        const link = href ? (href.startsWith("http") ? href : ("https://www.thermofisher.com"+href)) : null;
        const hasSpecies = !!b.querySelector('.item.species-item');
        return name && link ? {vendor:"Thermo Fisher", product_name:name, target:null, species:null, conjugate:null, link, hasSpecies} : null;
      }).filter(Boolean));
      rows = rows.map(r => ({
        ...r,
        target,
        species,
        conjugate: (() => {
          const m = /\)\s*,\s*([^,]+)(?:,|$)/.exec(r.product_name);
          return m ? m[1].trim() : r.product_name;
        })()
      })).filter(r => r.hasSpecies);
    }

    if (vendor === "bd") {
      await page.waitForSelector("div.pdp-search-card__body, .pdp-search-card", { timeout: 20000 }).catch(()=>{});
      rows = await page.$$eval("div.pdp-search-card__body, .pdp-search-card", cards => cards.map(card => {
        const a = card.querySelector("a.card-title.pdp-search-card__body-title, a.card-title");
        const name = a ? a.textContent.trim().replace(/\s+/g," ") : null;
        const href = a ? a.getAttribute("href") : null;
        const link = href ? (href.startsWith("http") ? href : ("https://www.bdbiosciences.com"+href)) : null;
        return name && link ? {vendor:"BD Biosciences", product_name:name, target:null, species:null, conjugate:null, link} : null;
      }).filter(Boolean));
      rows = rows.map(r => ({
        ...r,
        target,
        species,
        conjugate: (() => {
          const m = /\)\s*(.*)$/.exec(r.product_name);
          return m ? m[1].trim() : r.product_name;
        })()
      }));
    }

    // filter: enforce domain + fill species exactly from query
    const domainOK = v => (v==="BioLegend" ? "biolegend.com" :
                           v==="Thermo Fisher" ? "thermofisher.com" : "bdbiosciences.com");
    const final = [];
    const seen = new Set();
    for (const r of rows) {
      if (!r.link || !r.link.includes(domainOK(r.vendor))) continue;
      const key = `${r.vendor}|${r.product_name}|${r.link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      final.push({ ...r, species });
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
