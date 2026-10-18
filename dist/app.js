import {
  STATES, VARIABLES, METRIC_META, DEMO_RECORD, DEMO_TRENDS,
  buildCensusUrl, parseCensusResponse, computeMetrics, formatMetric,
  metricDelta, normalizeVariableCodes, toCsv,
} from "./lib.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  state: $("#state-select"), county: $("#county-select"), year: $("#year-select"),
  explore: $("#explore-button"), place: $("#place-name"), profileYear: $("#profile-year"),
  statusText: $("#status-text"), statusDot: $("#status-dot"), retry: $("#retry-button"),
  kpis: $("#kpi-grid"), trend: $("#trend-chart"), race: $("#race-chart"),
  profile: $("#profile-chart"), insight: $("#insight-text"), theme: $("#theme-toggle"),
  share: $("#share-button"), export: $("#export-button"), dialog: $("#export-dialog"),
  toast: $("#toast"), compareSelect: $("#compare-state-select"),
  compareCards: $("#comparison-cards"), compareTable: $("#comparison-table"),
  apiKeyButton: $("#api-key-button"), apiKeyDialog: $("#api-key-dialog"),
  apiKeyForm: $("#api-key-form"), apiKeyInput: $("#api-key-input"),
  showKey: $("#show-key-button"), forgetKey: $("#forget-key-button"),
  map: $("#state-map"), mapMetric: $("#map-metric-select"), mapStatus: $("#map-status"),
  compareLevel: $("#compare-level-select"), compareCounty: $("#compare-county-select"),
  compareYear: $("#compare-year-select"),
  variableInput: $("#variable-code-input"), runCustom: $("#run-custom-query"),
  queryMessage: $("#query-message"), customTable: $("#custom-results-table"),
  customPlace: $("#custom-result-place"), exportCustom: $("#export-custom-query"),
};

const STATE_TILES = {
  WA:[2,1], OR:[2,2], CA:[2,3], ID:[3,2], NV:[3,3], MT:[4,1], WY:[4,2], UT:[4,3], AZ:[4,4],
  ND:[5,1], SD:[5,2], CO:[5,3], NM:[5,4], MN:[6,1], NE:[6,2], KS:[6,3], OK:[6,4], TX:[6,5],
  WI:[7,1], IA:[7,2], MO:[7,3], AR:[7,4], LA:[7,5], MI:[8,1], IL:[8,2], MS:[8,5], IN:[9,2],
  KY:[9,3], TN:[9,4], AL:[9,5], OH:[10,2], WV:[10,3], GA:[10,5], DC:[10,6], FL:[11,7],
  NY:[10,1], PA:[10,2], VA:[11,3], NC:[11,4], SC:[11,5], VT:[11,1], NJ:[11,2], MD:[11,6],
  NH:[12,1], CT:[12,3], DE:[12,5], ME:[13,1], MA:[13,2], RI:[13,4],
  AK:[1,7], HI:[3,7], PR:[5,7],
};

const VARIABLE_LABELS = {
  B01003_001E: "Total population", B19013_001E: "Median household income",
  B25077_001E: "Median home value", B01002_001E: "Median age",
  B17001_002E: "Population below poverty level", B25003_002E: "Owner-occupied housing units",
};

function readSessionKey() {
  try { return sessionStorage.getItem("census-api-key") || ""; }
  catch { return ""; }
}

function writeSessionKey(value) {
  try {
    if (value) sessionStorage.setItem("census-api-key", value);
    else sessionStorage.removeItem("census-api-key");
  } catch { /* The dashboard still works in demo mode when storage is blocked. */ }
}

const params = new URLSearchParams(location.search);
const state = {
  fips: STATES.some((item) => item.fips === params.get("state")) ? params.get("state") : "24",
  county: params.get("county") || "",
  year: Math.min(2024, Math.max(2015, Number(params.get("year")) || 2024)),
  record: null,
  trends: [],
  trendMetric: "population",
  comparePlaces: [{ state: "24", county: "" }, { state: "51", county: "" }, { state: "06", county: "" }],
  compareRecords: new Map(),
  mapRecords: [],
  mapGeometry: null,
  mapPath: null,
  mapGeometryFailed: false,
  customRows: [],
  mode: "loading",
  apiKey: readSessionKey(),
};

function initOptions() {
  const stateOptions = STATES.map(({ fips, name }) => `<option value="${fips}">${name}</option>`).join("");
  elements.state.innerHTML = stateOptions;
  elements.compareSelect.innerHTML = stateOptions;
  elements.state.value = state.fips;
  elements.compareSelect.value = "36";
  const yearOptions = Array.from({ length: 10 }, (_, index) => 2024 - index)
    .map((year) => `<option value="${year}">${year}</option>`).join("");
  elements.year.innerHTML = yearOptions;
  elements.compareYear.innerHTML = yearOptions;
  elements.year.value = String(state.year);
  elements.compareYear.value = String(state.year);
}

function renderSkeleton() {
  elements.kpis.setAttribute("aria-busy", "true");
  elements.kpis.innerHTML = Object.keys(METRIC_META).map((key, index) => `
    <article class="kpi-card" data-index="${String(index + 1).padStart(2, "0")}">
      <div class="kpi-label">${METRIC_META[key].label}</div>
      <div class="kpi-value skeleton">&nbsp;</div>
      <div class="kpi-note">Loading estimate…</div>
    </article>`).join("");
}

function setStatus(mode, message) {
  state.mode = mode;
  elements.statusDot.className = `status-dot ${mode === "live" ? "live" : mode === "demo" ? "demo" : ""}`;
  elements.statusText.textContent = message;
  elements.retry.hidden = mode !== "demo";
}

async function fetchJson(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Census API request failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadCounties() {
  const requestedCounty = state.county;
  elements.county.disabled = true;
  elements.county.innerHTML = '<option value="">Loading counties…</option>';
  try {
    const counties = await getCounties(state.fips);
    elements.county.innerHTML = '<option value="">Entire state</option>' + counties
      .sort((a, b) => a.NAME.localeCompare(b.NAME))
      .map((county) => `<option value="${county.county}">${county.NAME.split(",")[0]}</option>`).join("");
    elements.county.value = counties.some((item) => item.county === requestedCounty) ? requestedCounty : "";
    state.county = elements.county.value;
  } catch {
    elements.county.innerHTML = '<option value="">Entire state</option>';
    state.county = "";
  } finally {
    elements.county.disabled = false;
  }
}

async function getCounties(stateFips) {
  if (!state.apiKey) throw new Error("A Census API key is required to load counties.");
  const url = buildCensusUrl({ year: state.year, geography: "county", state: stateFips, county: "*", variables: ["NAME"], apiKey: state.apiKey });
  return parseCensusResponse(await fetchJson(url)).sort((a, b) => a.NAME.localeCompare(b.NAME));
}

async function fetchRecord({ fips, county = "", year = state.year }) {
  const url = buildCensusUrl({ year, geography: county ? "county" : "state", state: fips, county, variables: VARIABLES, apiKey: state.apiKey });
  const [record] = parseCensusResponse(await fetchJson(url));
  if (!record) throw new Error("No Census observation was returned.");
  return record;
}

async function fetchTrends() {
  const years = Array.from({ length: 6 }, (_, index) => state.year - 5 + index).filter((year) => year >= 2015);
  const variables = ["NAME", "B01003_001E", "B19013_001E"];
  const rows = await Promise.all(years.map(async (year) => {
    const url = buildCensusUrl({ year, geography: state.county ? "county" : "state", state: state.fips, county: state.county, variables, apiKey: state.apiKey });
    const [record] = parseCensusResponse(await fetchJson(url));
    return { year, population: record?.B01003_001E ?? null, income: record?.B19013_001E ?? null };
  }));
  return rows;
}

async function loadProfile() {
  renderSkeleton();
  setStatus("loading", "Requesting estimates from the Census Bureau…");
  state.fips = elements.state.value;
  state.county = elements.county.value;
  state.year = Number(elements.year.value);
  elements.compareYear.value = String(state.year);
  syncUrl();
  try {
    if (!state.apiKey) throw new Error("A Census API key is required for live data.");
    const [record, trends] = await Promise.all([
      fetchRecord({ fips: state.fips, county: state.county }),
      fetchTrends(),
    ]);
    state.record = record;
    state.trends = trends;
    setStatus("live", `Live ${state.year} ACS 5-year estimates · U.S. Census Bureau`);
  } catch (error) {
    const selected = STATES.find((item) => item.fips === state.fips);
    state.record = { ...DEMO_RECORD, NAME: `${selected.name} (demo profile)`, state: state.fips };
    state.trends = DEMO_TRENDS.map((row) => ({ ...row, year: row.year + (state.year - 2024) }));
    setStatus("demo", state.apiKey
      ? "Live request failed · Check your API key or retry · Showing demo data"
      : "Demo mode · Add a free Census API key for live data");
    console.warn(error);
  }
  renderProfile();
  await loadMapData();
}

function renderProfile() {
  const metrics = computeMetrics(state.record);
  const previous = state.trends.at(-2) || {};
  elements.place.textContent = state.record.NAME.replace(/, [A-Z][a-z].*$/, "");
  elements.profileYear.textContent = `${state.year} estimates`;
  elements.kpis.removeAttribute("aria-busy");
  elements.kpis.innerHTML = Object.entries(METRIC_META).map(([key, meta], index) => {
    const item = metrics[key];
    const trendValue = key === "population" ? metricDelta(item.value, previous.population) : key === "income" ? metricDelta(item.value, previous.income) : null;
    const note = Number.isFinite(item.moe) && item.moe > 0
      ? `± ${formatMetric(item.moe, meta.unit)} margin of error`
      : Number.isFinite(trendValue) ? `<strong>${trendValue >= 0 ? "↑" : "↓"} ${Math.abs(trendValue).toFixed(1)}%</strong> from prior estimate` : `ACS table ${meta.source}`;
    return `<article class="kpi-card" data-index="${String(index + 1).padStart(2, "0")}">
      <div class="kpi-label">${meta.label}</div>
      <div class="kpi-value">${formatMetric(item.value, meta.unit)}</div>
      <div class="kpi-note">${note}</div>
    </article>`;
  }).join("");
  renderTrend();
  renderRace();
  renderCommunityProfile(metrics);
  renderInsight(metrics);
}

function renderTrend() {
  const values = state.trends.map((item) => item[state.trendMetric]).filter(Number.isFinite);
  if (values.length < 2) {
    elements.trend.innerHTML = "<p>Trend data is not available for this selection.</p>";
    return;
  }
  const width = 700, height = 250, padX = 44, padY = 28;
  const min = Math.min(...values) * .985, max = Math.max(...values) * 1.015;
  const x = (index) => padX + (index / (state.trends.length - 1)) * (width - padX * 2);
  const y = (value) => height - padY - ((value - min) / (max - min || 1)) * (height - padY * 2);
  const points = state.trends.map((item, index) => `${x(index)},${y(item[state.trendMetric])}`).join(" ");
  const area = `${padX},${height - padY} ${points} ${width - padX},${height - padY}`;
  const unit = state.trendMetric === "income" ? "currency" : "number";
  elements.trend.setAttribute("aria-label", `${METRIC_META[state.trendMetric].label} from ${state.trends[0].year} to ${state.trends.at(-1).year}`);
  elements.trend.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img">
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8633b"/><stop offset="1" stop-color="#e8633b" stop-opacity="0"/></linearGradient></defs>
    ${[0, .5, 1].map((position) => `<line class="chart-grid" x1="${padX}" y1="${padY + position * (height - padY * 2)}" x2="${width - padX}" y2="${padY + position * (height - padY * 2)}"/>`).join("")}
    <polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${points}"/>
    ${state.trends.map((item, index) => `<g><circle class="chart-dot" cx="${x(index)}" cy="${y(item[state.trendMetric])}" r="4"/><text class="chart-value" x="${x(index)}" y="${y(item[state.trendMetric]) - 12}" text-anchor="middle">${formatMetric(item[state.trendMetric], unit)}</text><text class="chart-label" x="${x(index)}" y="${height - 6}" text-anchor="middle">${item.year}</text></g>`).join("")}
  </svg>`;
}

function renderRace() {
  const r = state.record;
  const total = r.B03002_001E || 1;
  const rows = [
    ["White, non-Hispanic", r.B03002_003E], ["Black", r.B03002_004E],
    ["Asian", r.B03002_006E], ["Hispanic or Latino", r.B03002_012E],
    ["Two or more races", r.B03002_009E],
  ].map(([label, value]) => ({ label, value: Number.isFinite(value) ? value / total * 100 : null }))
    .filter((item) => Number.isFinite(item.value)).sort((a, b) => b.value - a.value);
  const max = Math.max(...rows.map((item) => item.value), 1);
  elements.race.innerHTML = rows.map((item) => `<div class="bar-row"><div class="bar-row-head"><span>${item.label}</span><strong>${item.value.toFixed(1)}%</strong></div><div class="bar-track"><div class="bar-fill" style="width:${item.value / max * 100}%"></div></div></div>`).join("");
}

function renderCommunityProfile(metrics) {
  const rows = [
    ["Bachelor’s degree or higher", metrics.bachelors],
    ["Owner-occupied homes", metrics.homeownership],
    ["Below the poverty line", metrics.poverty],
    ["Civilian unemployment", metrics.unemployment],
  ];
  elements.profile.innerHTML = rows.map(([label, item]) => `<div class="profile-row"><span>${label}</span><strong>${formatMetric(item.value, "percent")}</strong></div>`).join("");
}

function renderInsight(metrics) {
  const place = state.record.NAME.split(",")[0];
  const facts = [
    Number.isFinite(metrics.income.value) ? `median household income is ${formatMetric(metrics.income.value, "currency")}` : "",
    Number.isFinite(metrics.homeownership.value) ? `${formatMetric(metrics.homeownership.value, "percent")} of occupied homes are owner-occupied` : "",
    Number.isFinite(metrics.poverty.value) ? `${formatMetric(metrics.poverty.value, "percent")} of residents are below the poverty line` : "",
  ].filter(Boolean);
  elements.insight.textContent = facts.length
    ? `${place}: ${facts.slice(0, 2).join("; ")}.`
    : `${place}: no summary measures are available for this selection.`;
}

async function loadMapData() {
  if (state.apiKey) {
    try {
      const url = buildCensusUrl({ year: state.year, geography: "state", state: "*", variables: VARIABLES, apiKey: state.apiKey });
      state.mapRecords = parseCensusResponse(await fetchJson(url));
      elements.mapStatus.textContent = `Live ${state.year} ACS data`;
      await ensureMapGeometry();
      renderMap();
      return;
    } catch (error) {
      console.warn(error);
    }
  }
  state.mapRecords = STATES.map((item, index) => {
    const factor = .35 + ((Number(item.fips) * 17) % 90) / 50;
    return {
      ...DEMO_RECORD, NAME: item.name, state: item.fips,
      B01003_001E: Math.round(DEMO_RECORD.B01003_001E * factor),
      B19013_001E: Math.round(DEMO_RECORD.B19013_001E * (.68 + ((index * 11) % 55) / 100)),
      B17001_002E: Math.round(DEMO_RECORD.B17001_001E * (.06 + ((index * 7) % 14) / 100)),
      B25003_002E: Math.round(DEMO_RECORD.B25003_001E * (.48 + ((index * 5) % 28) / 100)),
    };
  });
  elements.mapStatus.textContent = "Illustrative demo pattern · Add API key for live values";
  await ensureMapGeometry();
  renderMap();
}

function renderMap() {
  if (!state.mapGeometry && !state.mapGeometryFailed) {
    elements.map.className = "geo-map map-loading";
    elements.map.textContent = "Loading geographic boundaries…";
    return;
  }
  const metricKey = elements.mapMetric.value;
  const meta = METRIC_META[metricKey];
  const rows = state.mapRecords.map((record) => ({
    record, value: computeMetrics(record)[metricKey]?.value,
    stateInfo: STATES.find((item) => item.fips === record.state),
  })).filter((item) => item.stateInfo && STATE_TILES[item.stateInfo.abbreviation]);
  const values = rows.map((item) => item.value).filter(Number.isFinite);
  const min = Math.min(...values), max = Math.max(...values);
  if (!state.mapGeometry) {
    renderTileMap(rows, min, max, meta);
    return;
  }
  const rowByFips = new Map(rows.map((item) => [item.record.state, item]));
  elements.map.className = "geo-map";
  elements.map.innerHTML = `<svg viewBox="0 0 975 610" role="img" aria-labelledby="map-title map-description">
    <title id="map-title">United States ${meta.label} map</title>
    <desc id="map-description">State boundaries colored from lower to higher ${meta.label.toLowerCase()}. Select a state to open its profile.</desc>
    ${state.mapGeometry.map((feature) => {
      const fips = String(feature.id).padStart(2, "0");
      const item = rowByFips.get(fips);
      const value = item?.value;
      const stateInfo = item?.stateInfo || STATES.find((candidate) => candidate.fips === fips);
      if (!stateInfo) return "";
      const shade = Number.isFinite(value) ? Math.round(((value - min) / (max - min || 1)) * 100) : 0;
      const label = `${stateInfo.name}: ${formatMetric(value, meta.unit)}`;
      const path = state.mapPath(feature);
      if (!path) return "";
      return `<path class="geo-state ${Number.isFinite(value) ? "" : "no-data"} ${fips === state.fips ? "selected" : ""}" d="${path}" style="--shade:${14 + shade * .72}%" data-map-state="${fips}" tabindex="0" role="button" aria-label="${label}"></path>`;
    }).join("")}
  </svg><div class="map-tooltip" role="tooltip" hidden></div>`;
  $("#map-low").textContent = Number.isFinite(min) ? formatMetric(min, meta.unit) : "Lower";
  $("#map-high").textContent = Number.isFinite(max) ? formatMetric(max, meta.unit) : "Higher";
}

function renderTileMap(rows, min, max, meta) {
  elements.map.className = "state-map";
  elements.map.innerHTML = rows.map(({ record, value, stateInfo }) => {
    const [column, row] = STATE_TILES[stateInfo.abbreviation];
    const shade = Number.isFinite(value) ? Math.round(((value - min) / (max - min || 1)) * 100) : 0;
    const label = `${stateInfo.name}: ${formatMetric(value, meta.unit)}`;
    return `<button class="state-tile ${Number.isFinite(value) ? "" : "no-data"} ${record.state === state.fips ? "selected" : ""}" style="grid-column:${column};grid-row:${row};--shade:${14 + shade * .72}%" data-map-state="${record.state}" aria-label="${label}">${stateInfo.abbreviation}</button>`;
  }).join("") + '<div class="map-tooltip" role="tooltip" hidden></div>';
  $("#map-low").textContent = Number.isFinite(min) ? formatMetric(min, meta.unit) : "Lower";
  $("#map-high").textContent = Number.isFinite(max) ? formatMetric(max, meta.unit) : "Higher";
}

async function ensureMapGeometry() {
  if (state.mapGeometry || state.mapGeometryFailed) return;
  elements.map.className = "geo-map map-loading";
  elements.map.textContent = "Loading geographic boundaries…";
  try {
    const [{ feature }, d3Geo, response] = await Promise.all([
      import("https://cdn.jsdelivr.net/npm/topojson-client@3/+esm"),
      import("https://cdn.jsdelivr.net/npm/d3-geo@3/+esm"),
      fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"),
    ]);
    if (!response.ok) throw new Error(`Boundary request failed (${response.status})`);
    const topology = await response.json();
    const collection = feature(topology, topology.objects.states);
    const projection = d3Geo.geoAlbersUsa().fitExtent([[20, 20], [955, 590]], collection);
    state.mapGeometry = collection.features;
    state.mapPath = d3Geo.geoPath(projection);
  } catch (error) {
    state.mapGeometryFailed = true;
    elements.mapStatus.textContent = `${elements.mapStatus.textContent} · Tile fallback`;
    console.warn("Geographic boundaries unavailable; using tile fallback.", error);
  }
}

function syncUrl() {
  const next = new URL(location.href);
  next.searchParams.set("state", state.fips);
  next.searchParams.set("year", String(state.year));
  state.county ? next.searchParams.set("county", state.county) : next.searchParams.delete("county");
  history.replaceState(null, "", next);
}

function switchSection(section) {
  document.body.dataset.section = section;
  $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.section === section));
  $$(".dashboard-section").forEach((panel) => {
    const visible = panel.id === `${section}-section`;
    panel.hidden = !visible;
    panel.classList.toggle("active-section", visible);
  });
  if (section === "compare") loadComparisons();
  scrollTo({ top: Math.max(0, $(".status-bar").offsetTop - 90), behavior: "smooth" });
}

async function loadComparisons() {
  elements.compareCards.innerHTML = state.comparePlaces.map((place) => {
    const key = comparisonKey(place);
    const cached = state.compareRecords.get(`${key}-${state.year}`);
    const stateInfo = STATES.find((candidate) => candidate.fips === place.state);
    const name = cached?.NAME?.split(",")[0] || stateInfo?.name || key;
    return `<span class="comparison-chip">${name}<button data-remove="${key}" aria-label="Remove ${name}">×</button></span>`;
  }).join("");
  elements.compareTable.innerHTML = '<tbody><tr><td>Loading comparison…</td></tr></tbody>';
  await Promise.all(state.comparePlaces.map(async (place) => {
    const key = `${comparisonKey(place)}-${state.year}`;
    if (state.compareRecords.has(key)) return;
    try {
      if (!state.apiKey) throw new Error("Live comparison requires an API key.");
      state.compareRecords.set(key, await fetchRecord({ fips: place.state, county: place.county }));
    } catch {
      const stateInfo = STATES.find((item) => item.fips === place.state);
      const factor = .78 + Number(place.state) / 120;
      const fallbackName = place.county ? `County ${place.county}, ${stateInfo.name} (demo)` : `${stateInfo.name} (demo)`;
      state.compareRecords.set(key, { ...DEMO_RECORD, NAME: fallbackName, state: place.state, county: place.county, B01003_001E: Math.round(DEMO_RECORD.B01003_001E * factor), B19013_001E: Math.round(DEMO_RECORD.B19013_001E * (.85 + Number(place.state) / 300)) });
    }
  }));
  elements.compareCards.innerHTML = state.comparePlaces.map((place) => {
    const key = comparisonKey(place);
    const name = state.compareRecords.get(`${key}-${state.year}`)?.NAME?.split(",")[0] || key;
    return `<span class="comparison-chip">${name}<button data-remove="${key}" aria-label="Remove ${name}">×</button></span>`;
  }).join("");
  renderComparisonTable();
}

function comparisonKey(place) {
  return `${place.state}:${place.county || "state"}`;
}

function renderComparisonTable() {
  const records = state.comparePlaces.map((place) => state.compareRecords.get(`${comparisonKey(place)}-${state.year}`)).filter(Boolean);
  const keys = ["population", "income", "age", "poverty", "homeValue", "bachelors"];
  elements.compareTable.innerHTML = `<thead><tr><th>Indicator</th>${records.map((record) => `<th>${record.NAME.split(",")[0]}</th>`).join("")}</tr></thead><tbody>${keys.map((key) => `<tr><td>${METRIC_META[key].label}</td>${records.map((record) => `<td>${formatMetric(computeMetrics(record)[key].value, METRIC_META[key].unit)}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

async function loadCompareCounties() {
  const countyMode = elements.compareLevel.value === "county";
  elements.compareCounty.hidden = !countyMode;
  if (!countyMode) return;
  elements.compareCounty.innerHTML = '<option value="">Loading counties…</option>';
  if (!state.apiKey) {
    elements.compareCounty.innerHTML = '<option value="">Add API key to load counties</option>';
    elements.compareCounty.disabled = true;
    return;
  }
  try {
    const counties = await getCounties(elements.compareSelect.value);
    elements.compareCounty.innerHTML = '<option value="">Choose county</option>' + counties.map((county) => `<option value="${county.county}">${county.NAME.split(",")[0]}</option>`).join("");
    elements.compareCounty.disabled = false;
  } catch {
    elements.compareCounty.innerHTML = '<option value="">Counties unavailable</option>';
  }
}

function download(type) {
  const metrics = computeMetrics(state.record);
  const rows = Object.entries(METRIC_META).map(([key, meta]) => ({
    geography: state.record.NAME, year: state.year, dataset: "ACS 5-year",
    metric: meta.label, value: metrics[key].value, margin_of_error: metrics[key].moe ?? "",
    source_table: meta.source,
  }));
  const content = type === "csv" ? toCsv(rows) : JSON.stringify({ metadata: { geography: state.record.NAME, year: state.year, dataset: "ACS 5-year", mode: state.mode }, data: rows }, null, 2);
  const blob = new Blob([content], { type: type === "csv" ? "text/csv;charset=utf-8" : "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `census-atlas-${state.fips}${state.county ? `-${state.county}` : ""}-${state.year}.${type}`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  elements.dialog.close();
  toast(`${type.toUpperCase()} export downloaded`);
}

async function runCustomQuery() {
  elements.queryMessage.className = "query-message";
  const { valid, invalid, truncated } = normalizeVariableCodes(elements.variableInput.value);
  if (!valid.length) {
    elements.queryMessage.textContent = "Enter at least one complete variable code, such as B01003_001E.";
    elements.queryMessage.classList.add("error");
    return;
  }
  if (invalid.length) {
    elements.queryMessage.textContent = `These codes are not complete Census variables: ${invalid.join(", ")}`;
    elements.queryMessage.classList.add("error");
    return;
  }
  if (!state.apiKey) {
    elements.queryMessage.textContent = "Add your Census API key to run a custom query.";
    elements.queryMessage.classList.add("error");
    elements.apiKeyButton.click();
    return;
  }
  elements.runCustom.disabled = true;
  elements.runCustom.textContent = "Running query…";
  elements.queryMessage.textContent = truncated ? "Using the first 20 unique variables." : "Requesting data from the Census Bureau…";
  try {
    const selectedState = elements.state.value;
    const selectedCounty = elements.county.value;
    const year = Number(elements.year.value);
    const url = buildCensusUrl({ year, geography: selectedCounty ? "county" : "state", state: selectedState, county: selectedCounty, variables: ["NAME", ...valid], apiKey: state.apiKey });
    const [record] = parseCensusResponse(await fetchJson(url));
    if (!record) throw new Error("No observation returned.");
    state.customRows = valid.map((code) => ({
      geography: record.NAME, year, variable: code,
      label: VARIABLE_LABELS[code] || "Custom ACS variable",
      value: record[code],
    }));
    elements.customPlace.textContent = record.NAME;
    elements.customTable.innerHTML = `<thead><tr><th>Variable</th><th>Description</th><th>Value</th></tr></thead><tbody>${state.customRows.map((row) => `<tr><td><code>${row.variable}</code></td><td>${row.label}</td><td>${formatMetric(row.value, "number", { full: true })}</td></tr>`).join("")}</tbody>`;
    elements.exportCustom.hidden = false;
    elements.queryMessage.textContent = `${valid.length} variable${valid.length === 1 ? "" : "s"} loaded for ${record.NAME}.`;
  } catch (error) {
    elements.queryMessage.textContent = "The Census query failed. Check the variable codes, year, geography, and API key.";
    elements.queryMessage.classList.add("error");
    console.warn(error);
  } finally {
    elements.runCustom.disabled = false;
    elements.runCustom.innerHTML = 'Run Census query <span aria-hidden="true">↗</span>';
  }
}

function exportCustomQuery() {
  if (!state.customRows.length) return;
  const blob = new Blob([toCsv(state.customRows)], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `census-atlas-custom-query-${state.year}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  toast("Custom query CSV downloaded");
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function showMapTooltip(target, clientX, clientY) {
  const tooltip = elements.map.querySelector(".map-tooltip");
  if (!tooltip || !target) return;
  tooltip.textContent = target.getAttribute("aria-label") || "";
  tooltip.hidden = false;
  const mapBounds = elements.map.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const anchorX = Number.isFinite(clientX) ? clientX - mapBounds.left : targetBounds.left - mapBounds.left + targetBounds.width / 2;
  const anchorY = Number.isFinite(clientY) ? clientY - mapBounds.top : targetBounds.top - mapBounds.top;
  const left = Math.min(Math.max(8, anchorX + 12), Math.max(8, mapBounds.width - tooltip.offsetWidth - 8));
  const top = Math.min(Math.max(8, anchorY - tooltip.offsetHeight - 12), Math.max(8, mapBounds.height - tooltip.offsetHeight - 8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideMapTooltip() {
  const tooltip = elements.map.querySelector(".map-tooltip");
  if (tooltip) tooltip.hidden = true;
}

function bindEvents() {
  elements.state.addEventListener("change", async () => {
    state.fips = elements.state.value; state.county = "";
    if (state.apiKey) await loadCounties();
    else elements.county.innerHTML = '<option value="">Entire state</option>';
  });
  elements.explore.addEventListener("click", loadProfile);
  elements.retry.addEventListener("click", loadProfile);
  $$(".nav-link").forEach((button) => button.addEventListener("click", () => switchSection(button.dataset.section)));
  $$("[data-trend]").forEach((button) => button.addEventListener("click", () => {
    state.trendMetric = button.dataset.trend;
    $$("[data-trend]").forEach((item) => item.classList.toggle("active", item === button));
    renderTrend();
  }));
  elements.theme.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("census-atlas-theme", dark ? "dark" : "light");
  });
  elements.share.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Shareable view copied"); }
    catch { toast("Copy the current URL to share this view"); }
  });
  elements.export.addEventListener("click", () => elements.dialog.showModal());
  $$("[data-export]").forEach((button) => button.addEventListener("click", () => download(button.dataset.export)));
  elements.mapMetric.addEventListener("change", renderMap);
  elements.map.addEventListener("click", async (event) => {
    const fips = event.target.dataset.mapState;
    if (!fips) return;
    elements.state.value = fips;
    state.fips = fips;
    state.county = "";
    if (state.apiKey) await loadCounties();
    else elements.county.innerHTML = '<option value="">Entire state</option>';
    await loadProfile();
    scrollTo({ top: Math.max(0, $(".status-bar").offsetTop - 90), behavior: "smooth" });
  });
  elements.map.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.dataset.mapState) {
      event.preventDefault();
      event.target.click();
    }
  });
  elements.map.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-map-state]");
    if (target) showMapTooltip(target, event.clientX, event.clientY);
  });
  elements.map.addEventListener("pointermove", (event) => {
    const target = event.target.closest?.("[data-map-state]");
    if (target) showMapTooltip(target, event.clientX, event.clientY);
  });
  elements.map.addEventListener("pointerout", (event) => {
    if (event.target.closest?.("[data-map-state]")) hideMapTooltip();
  });
  elements.map.addEventListener("focusin", (event) => {
    const target = event.target.closest?.("[data-map-state]");
    if (target) showMapTooltip(target);
  });
  elements.map.addEventListener("focusout", hideMapTooltip);
  elements.compareLevel.addEventListener("change", loadCompareCounties);
  elements.compareSelect.addEventListener("change", loadCompareCounties);
  elements.compareYear.addEventListener("change", () => {
    state.year = Number(elements.compareYear.value);
    elements.year.value = String(state.year);
    syncUrl();
    loadComparisons();
  });
  $("#add-compare-button").addEventListener("click", () => {
    const countyMode = elements.compareLevel.value === "county";
    const place = { state: elements.compareSelect.value, county: countyMode ? elements.compareCounty.value : "" };
    if (countyMode && !place.county) return toast("Choose a county first");
    if (state.comparePlaces.some((item) => comparisonKey(item) === comparisonKey(place))) return toast("That place is already in the comparison");
    if (state.comparePlaces.length >= 4) return toast("Compare up to four places at a time");
    state.comparePlaces.push(place); loadComparisons();
  });
  elements.compareCards.addEventListener("click", (event) => {
    const key = event.target.dataset.remove;
    if (!key) return;
    state.comparePlaces = state.comparePlaces.filter((item) => comparisonKey(item) !== key);
    loadComparisons();
  });
  elements.runCustom.addEventListener("click", runCustomQuery);
  elements.exportCustom.addEventListener("click", exportCustomQuery);
  elements.apiKeyButton.addEventListener("click", () => {
    elements.apiKeyInput.value = state.apiKey;
    elements.apiKeyInput.type = "password";
    elements.showKey.textContent = "Show";
    elements.showKey.setAttribute("aria-pressed", "false");
    elements.forgetKey.hidden = !state.apiKey;
    elements.apiKeyDialog.showModal();
    elements.apiKeyInput.focus();
  });
  $("[data-close-key]").addEventListener("click", () => elements.apiKeyDialog.close());
  elements.showKey.addEventListener("click", () => {
    const show = elements.apiKeyInput.type === "password";
    elements.apiKeyInput.type = show ? "text" : "password";
    elements.showKey.textContent = show ? "Hide" : "Show";
    elements.showKey.setAttribute("aria-pressed", String(show));
  });
  elements.apiKeyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const apiKey = elements.apiKeyInput.value.trim();
    if (!apiKey) return;
    state.apiKey = apiKey;
    writeSessionKey(apiKey);
    state.compareRecords.clear();
    elements.apiKeyButton.textContent = "Manage API key";
    elements.apiKeyDialog.close();
    toast("API key saved for this tab");
    await loadCounties();
    await loadCompareCounties();
    await loadProfile();
  });
  elements.forgetKey.addEventListener("click", async () => {
    state.apiKey = "";
    writeSessionKey("");
    state.compareRecords.clear();
    elements.apiKeyInput.value = "";
    elements.apiKeyButton.textContent = "Add API key";
    elements.apiKeyDialog.close();
    elements.county.innerHTML = '<option value="">Entire state</option>';
    state.county = "";
    toast("API key removed from this tab");
    await loadProfile();
  });
}

async function init() {
  const storedTheme = localStorage.getItem("census-atlas-theme");
  if (storedTheme) document.documentElement.dataset.theme = storedTheme;
  else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
  initOptions();
  elements.apiKeyButton.textContent = state.apiKey ? "Manage API key" : "Add API key";
  renderSkeleton();
  bindEvents();
  if (state.apiKey) await loadCounties();
  await loadProfile();
}

init();
