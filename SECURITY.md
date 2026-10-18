# Security

## Supported version

The latest deployed version is supported.

## Reporting

Please report a suspected vulnerability privately to the repository owner rather
than opening a public issue. Include reproduction steps and the affected URL or
file. Do not include Census API keys, tokens, or personal information.

## Data handling

Census Atlas does not collect user data. It stores only a color-theme preference
in local browser storage. Geography filters are encoded in the URL for sharing.
Production API keys must never be added to `dist/`, committed to Git, or sent to
the browser.
