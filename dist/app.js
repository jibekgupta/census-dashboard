import {
  STATES, VARIABLES, METRIC_META, DEMO_RECORD, DEMO_TRENDS,
  buildCensusUrl, parseCensusResponse, computeMetrics, formatMetric,
  metricDelta, toCsv,
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
};

const params = new URLSearchParams(location.search);
const state = {
  fips: STATES.some((item) => item.fips === params.get("state")) ? params.get("state") : "24",
  county: params.get("county") || "",
  year: Math.min(2024, Math.max(2015, Number(params.get("year")) || 2024)),
  record: null,
  trends: [],
  trendMetric: "population",
  compareFips: ["24", "51", "06"],
  compareRecords: new Map(),
  mode: "loading",
};

function initOptions() {
  const stateOptions = STATES.map(({ fips, name }) => `<option value="${fips}">${name}</option>`).join("");
  elements.state.innerHTML = stateOptions;
  elements.compareSelect.innerHTML = stateOptions;
  elements.state.value = state.fips;
  elements.compareSelect.value = "36";
  elements.year.innerHTML = Array.from({ length: 10 }, (_, index) => 2024 - index)
    .map((year) => `<option value="${year}">${year}</option>`).join("");
  elements.year.value = String(state.year);
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
    const url = buildCensusUrl({ year: state.year, geography: "county", state: state.fips, county: "*", variables: ["NAME"] });
    const counties = parseCensusResponse(await fetchJson(url));
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

async function fetchRecord({ fips, county = "", year = state.year }) {
  const url = buildCensusUrl({ year, geography: county ? "county" : "state", state: fips, county, variables: VARIABLES });
  const [record] = parseCensusResponse(await fetchJson(url));
  if (!record) throw new Error("No Census observation was returned.");
  return record;
}

async function fetchTrends() {
  const years = Array.from({ length: 6 }, (_, index) => state.year - 5 + index).filter((year) => year >= 2015);
  const variables = ["NAME", "B01003_001E", "B19013_001E"];
  const rows = await Promise.all(years.map(async (year) => {
    const url = buildCensusUrl({ year, geography: state.county ? "county" : "state", state: state.fips, county: state.county, variables });
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
  syncUrl();
  try {
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
    setStatus("demo", "Census API unavailable · Showing a clearly labeled demo profile");
    console.warn(error);
  }
  renderProfile();
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
  const descriptors = [];
  if (metrics.income.value > 90000) descriptors.push("household income is comparatively high");
  else if (metrics.income.value < 60000) descriptors.push("household income remains an economic pressure point");
  if (metrics.bachelors.value > 40) descriptors.push("educational attainment stands out");
  if (metrics.homeownership.value > 65) descriptors.push("homeownership is a defining part of the housing picture");
  if (metrics.poverty.value > 15) descriptors.push("poverty affects a meaningful share of residents");
  const sentence = descriptors.length ? descriptors.slice(0, 2).join(", while ") : "its social and economic indicators sit near the broad middle of the national landscape";
  elements.insight.textContent = `In ${place}, ${sentence}. These estimates describe a community in motion—not a final verdict on it.`;
}

function syncUrl() {
  const next = new URL(location.href);
  next.searchParams.set("state", state.fips);
  next.searchParams.set("year", String(state.year));
  state.county ? next.searchParams.set("county", state.county) : next.searchParams.delete("county");
  history.replaceState(null, "", next);
}

function switchSection(section) {
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
  elements.compareCards.innerHTML = state.compareFips.map((fips) => {
    const item = STATES.find((candidate) => candidate.fips === fips);
    return `<span class="comparison-chip">${item.name}<button data-remove="${fips}" aria-label="Remove ${item.name}">×</button></span>`;
  }).join("");
  elements.compareTable.innerHTML = '<tbody><tr><td>Loading comparison…</td></tr></tbody>';
  await Promise.all(state.compareFips.map(async (fips) => {
    if (state.compareRecords.has(`${fips}-${state.year}`)) return;
    try {
      state.compareRecords.set(`${fips}-${state.year}`, await fetchRecord({ fips }));
    } catch {
      const place = STATES.find((item) => item.fips === fips);
      const factor = .78 + Number(fips) / 120;
      state.compareRecords.set(`${fips}-${state.year}`, { ...DEMO_RECORD, NAME: place.name, B01003_001E: Math.round(DEMO_RECORD.B01003_001E * factor), B19013_001E: Math.round(DEMO_RECORD.B19013_001E * (.85 + Number(fips) / 300)) });
    }
  }));
  renderComparisonTable();
}

function renderComparisonTable() {
  const records = state.compareFips.map((fips) => state.compareRecords.get(`${fips}-${state.year}`)).filter(Boolean);
  const keys = ["population", "income", "age", "poverty", "homeValue", "bachelors"];
  elements.compareTable.innerHTML = `<thead><tr><th>Indicator</th>${records.map((record) => `<th>${record.NAME.split(",")[0]}</th>`).join("")}</tr></thead><tbody>${keys.map((key) => `<tr><td>${METRIC_META[key].label}</td>${records.map((record) => `<td>${formatMetric(computeMetrics(record)[key].value, METRIC_META[key].unit)}</td>`).join("")}</tr>`).join("")}</tbody>`;
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

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function bindEvents() {
  elements.state.addEventListener("change", async () => { state.fips = elements.state.value; state.county = ""; await loadCounties(); });
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
  $("#add-compare-button").addEventListener("click", () => {
    const fips = elements.compareSelect.value;
    if (state.compareFips.includes(fips)) return toast("That state is already in the comparison");
    if (state.compareFips.length >= 4) return toast("Compare up to four states at a time");
    state.compareFips.push(fips); loadComparisons();
  });
  elements.compareCards.addEventListener("click", (event) => {
    const fips = event.target.dataset.remove;
    if (!fips) return;
    state.compareFips = state.compareFips.filter((item) => item !== fips);
    loadComparisons();
  });
}

async function init() {
  const storedTheme = localStorage.getItem("census-atlas-theme");
  if (storedTheme) document.documentElement.dataset.theme = storedTheme;
  else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
  initOptions();
  renderSkeleton();
  bindEvents();
  await loadCounties();
  await loadProfile();
}

init();
