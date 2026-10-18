export const CENSUS_BASE = "https://api.census.gov/data";

export const STATES = [
  ["01", "Alabama", "AL"], ["02", "Alaska", "AK"], ["04", "Arizona", "AZ"],
  ["05", "Arkansas", "AR"], ["06", "California", "CA"], ["08", "Colorado", "CO"],
  ["09", "Connecticut", "CT"], ["10", "Delaware", "DE"], ["11", "District of Columbia", "DC"],
  ["12", "Florida", "FL"], ["13", "Georgia", "GA"], ["15", "Hawaii", "HI"],
  ["16", "Idaho", "ID"], ["17", "Illinois", "IL"], ["18", "Indiana", "IN"],
  ["19", "Iowa", "IA"], ["20", "Kansas", "KS"], ["21", "Kentucky", "KY"],
  ["22", "Louisiana", "LA"], ["23", "Maine", "ME"], ["24", "Maryland", "MD"],
  ["25", "Massachusetts", "MA"], ["26", "Michigan", "MI"], ["27", "Minnesota", "MN"],
  ["28", "Mississippi", "MS"], ["29", "Missouri", "MO"], ["30", "Montana", "MT"],
  ["31", "Nebraska", "NE"], ["32", "Nevada", "NV"], ["33", "New Hampshire", "NH"],
  ["34", "New Jersey", "NJ"], ["35", "New Mexico", "NM"], ["36", "New York", "NY"],
  ["37", "North Carolina", "NC"], ["38", "North Dakota", "ND"], ["39", "Ohio", "OH"],
  ["40", "Oklahoma", "OK"], ["41", "Oregon", "OR"], ["42", "Pennsylvania", "PA"],
  ["44", "Rhode Island", "RI"], ["45", "South Carolina", "SC"], ["46", "South Dakota", "SD"],
  ["47", "Tennessee", "TN"], ["48", "Texas", "TX"], ["49", "Utah", "UT"],
  ["50", "Vermont", "VT"], ["51", "Virginia", "VA"], ["53", "Washington", "WA"],
  ["54", "West Virginia", "WV"], ["55", "Wisconsin", "WI"], ["56", "Wyoming", "WY"],
  ["72", "Puerto Rico", "PR"],
].map(([fips, name, abbreviation]) => ({ fips, name, abbreviation }));

export const VARIABLES = [
  "NAME", "B01003_001E", "B01003_001M", "B19013_001E", "B19013_001M",
  "B01002_001E", "B01002_001M", "B17001_001E", "B17001_002E",
  "B23025_002E", "B23025_003E", "B23025_005E", "B25077_001E", "B25077_001M",
  "B25003_001E", "B25003_002E", "B15003_001E", "B15003_022E", "B15003_023E",
  "B15003_024E", "B15003_025E", "B01001_002E", "B01001_026E",
  "B03002_001E", "B03002_003E", "B03002_004E", "B03002_005E", "B03002_006E",
  "B03002_007E", "B03002_008E", "B03002_009E", "B03002_012E",
];

export const METRIC_META = {
  population: { label: "Population", unit: "number", source: "B01003" },
  income: { label: "Median household income", unit: "currency", source: "B19013" },
  age: { label: "Median age", unit: "years", source: "B01002" },
  poverty: { label: "Poverty rate", unit: "percent", source: "B17001" },
  unemployment: { label: "Unemployment rate", unit: "percent", source: "B23025" },
  homeValue: { label: "Median home value", unit: "currency", source: "B25077" },
  homeownership: { label: "Homeownership", unit: "percent", source: "B25003" },
  bachelors: { label: "Bachelor’s degree+", unit: "percent", source: "B15003" },
};

export function buildCensusUrl({ year, geography, state, county, variables = VARIABLES, apiKey = "" }) {
  const url = new URL(`${CENSUS_BASE}/${year}/acs/acs5`);
  url.searchParams.set("get", variables.join(","));
  if (geography === "county") {
    url.searchParams.set("for", `county:${county || "*"}`);
    url.searchParams.set("in", `state:${state}`);
  } else {
    url.searchParams.set("for", `state:${state}`);
  }
  if (apiKey) url.searchParams.set("key", apiKey);
  return url.toString();
}

export function parseCensusResponse(payload) {
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[0])) {
    throw new Error("The Census API returned an unexpected response.");
  }
  const [headers, ...rows] = payload;
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => {
    const raw = row[index];
    const preserve = header === "NAME" || header === "state" || header === "county";
    if (preserve) return [header, raw];
    const number = Number(raw);
    return [header, raw === null || raw === "" || number < -1e8 || !Number.isFinite(number) ? null : number];
  })));
}

const safeRate = (numerator, denominator) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
};

const sum = (record, fields) => fields.reduce((total, field) => total + (Number(record[field]) || 0), 0);

export function computeMetrics(record) {
  return {
    population: { value: record.B01003_001E, moe: record.B01003_001M },
    income: { value: record.B19013_001E, moe: record.B19013_001M },
    age: { value: record.B01002_001E, moe: record.B01002_001M },
    poverty: { value: safeRate(record.B17001_002E, record.B17001_001E), moe: null },
    unemployment: { value: safeRate(record.B23025_005E, record.B23025_002E), moe: null },
    homeValue: { value: record.B25077_001E, moe: record.B25077_001M },
    homeownership: { value: safeRate(record.B25003_002E, record.B25003_001E), moe: null },
    bachelors: {
      value: safeRate(sum(record, ["B15003_022E", "B15003_023E", "B15003_024E", "B15003_025E"]), record.B15003_001E),
      moe: null,
    },
  };
}

export function formatMetric(value, unit = "number", options = {}) {
  if (!Number.isFinite(value)) return "Not available";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "years") return `${value.toFixed(1)} yrs`;
  const currency = unit === "currency";
  if (options.full) {
    return new Intl.NumberFormat("en-US", currency ? { style: "currency", currency: "USD", maximumFractionDigits: 0 } : {}).format(value);
  }
  const prefix = currency ? "$" : "";
  if (Math.abs(value) >= 1e9) return `${prefix}${(value / 1e9).toFixed(2).replace(/\.00$/, "")}B`;
  if (Math.abs(value) >= 1e6) return `${prefix}${(value / 1e6).toFixed(2).replace(/\.00$/, "")}M`;
  if (Math.abs(value) >= 1e3) return `${prefix}${(value / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${prefix}${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
}

export function metricDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const string = value == null ? "" : String(value);
    return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\r\n");
}

export const DEMO_RECORD = {
  NAME: "Maryland", state: "24", B01003_001E: 6177224, B01003_001M: 0,
  B19013_001E: 101652, B19013_001M: 617, B01002_001E: 39.4, B01002_001M: 0.1,
  B17001_001E: 6028000, B17001_002E: 558000, B23025_002E: 3300000,
  B23025_003E: 3168000, B23025_005E: 132000, B25077_001E: 419900,
  B25077_001M: 2490, B25003_001E: 2350000, B25003_002E: 1574000,
  B15003_001E: 4250000, B15003_022E: 940000, B15003_023E: 455000,
  B15003_024E: 115000, B15003_025E: 95000, B01001_002E: 3020000,
  B01001_026E: 3157224, B03002_001E: 6177224, B03002_003E: 2970000,
  B03002_004E: 1780000, B03002_005E: 24000, B03002_006E: 450000,
  B03002_007E: 4500, B03002_008E: 205000, B03002_009E: 320000, B03002_012E: 730000,
};

export const DEMO_TRENDS = [
  { year: 2019, population: 6045680, income: 86738 },
  { year: 2020, population: 6055802, income: 87063 },
  { year: 2021, population: 6148545, income: 91431 },
  { year: 2022, population: 6164660, income: 98051 },
  { year: 2023, population: 6172333, income: 101652 },
  { year: 2024, population: 6177224, income: 103678 },
];
