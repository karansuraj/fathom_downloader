# Fathom Transcript Bulk Exporter

Simple Node.js script to download all your Fathom meeting transcripts.

## Setup

1. Get your API key from [Fathom Settings](https://fathom.video/customize#api-access-header)
2. Requires Node.js 18+ (for native fetch)
3. Install deps: `npm install`

## Usage

```bash
# Download transcripts
npm run download

# Search transcripts
npm run search -- "pricing"

# Option A: put variables in a .env file (recommended)
# Tip: start from example.env
cat > .env << 'EOF'
FATHOM_API_KEY=your_api_key_here
# OUTPUT_DIR=./transcripts
# INCLUDE_SUMMARY=true
# CREATED_AFTER=2024-01-01T00:00:00Z
# CREATED_BEFORE=2024-12-31T23:59:59Z
EOF
node download-transcripts.js

# Option B: inline env vars
FATHOM_API_KEY=your_api_key_here node download-transcripts.js

# Custom output directory
FATHOM_API_KEY=your_key OUTPUT_DIR=./my-transcripts node download-transcripts.js

# Filter by date range
FATHOM_API_KEY=your_key \
  CREATED_AFTER=2024-01-01T00:00:00Z \
  CREATED_BEFORE=2024-12-31T23:59:59Z \
  node download-transcripts.js

# Skip summaries (faster)
FATHOM_API_KEY=your_key INCLUDE_SUMMARY=false node download-transcripts.js
```

## Search options

```bash
# Add context around matches
npm run search -- "error budget" --context 2

# Choose a different transcript directory
npm run search -- "kubernetes" --dir ./some/other/dir

# Case sensitive search
npm run search -- "Kubernetes" --case-sensitive
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FATHOM_API_KEY` | Yes | - | Your Fathom API key |
| `OUTPUT_DIR` | No | `./transcripts` | Where to save files |
| `INCLUDE_SUMMARY` | No | `true` | Also download meeting summaries |
| `CREATED_AFTER` | No | - | Only meetings after this date (ISO format) |
| `CREATED_BEFORE` | No | - | Only meetings before this date (ISO format) |

## Output

Files are saved as Markdown with the format: `YYYY-MM-DD_Meeting_Title.md`

Each file contains:
- Meeting metadata (date, URL, recording ID)
- Summary (if available and enabled)
- Full transcript with timestamps and speaker names

## Rate Limits

Fathom's API allows 60 requests/minute. The script automatically:
- Adds delays between requests
- Handles rate limit (429) responses with retry

For 100 meetings with summaries, expect ~4 minutes runtime.

## Notes

- Your API key only accesses meetings you recorded or that are shared with your team
- Admin keys don't grant access to other users' unshared meetings
