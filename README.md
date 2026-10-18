# Census Atlas

Census Atlas is a responsive, accessible dashboard for exploring U.S. Census
American Community Survey (ACS) 5-year estimates. It runs as a static web app,
queries the public Census Data API directly, and includes a curated demo data
fallback so the experience remains useful during API outages.

## Features

- State and county profiles with URL-shareable filters
- Eight headline indicators with margins of error
- Six-year trends for population and median household income
- Demographic, housing, education, employment, and poverty breakdowns
- Side-by-side state comparison
- CSV and JSON export
- Dark/light theme, keyboard navigation, reduced-motion support, and responsive layout
- No API key or backend required

## Run locally

```bash
npm start
```

Open <http://localhost:4173>.

## Test

```bash
npm run check
```

The suite covers Census response parsing, calculations, formatting, query
construction, CSV export, and fallback behavior.

## Data and methodology

The app uses the U.S. Census Bureau ACS 5-year Detailed Tables API. Estimates
are accompanied by their published 90% margins of error where available.
Values shown as rates are calculated from published numerator and denominator
estimates and may differ slightly from Census profile-table values due to
rounding. ACS estimates are not a population census and should not be treated
as exact counts.

## Deployment

The production artifact is the `dist/` directory. It can be hosted on any
static host. This repository also contains `.openai/hosting.json` for OpenAI
Sites deployment.

## Privacy

The app has no accounts, cookies, analytics, or server-side storage. Filter and
theme preferences stay in the browser. Requests go directly from the browser
to `api.census.gov`.

## License

MIT. Census data is public-domain U.S. government data. This project is not
affiliated with or endorsed by the U.S. Census Bureau.
