# Competitive Visibility Audit

A Jupyter notebook that builds a competitive intelligence pipeline using Bright Data's Web Execution Layer APIs and OpenAI GPT for analysis.

## What It Does

This notebook performs a comprehensive competitive audit across 5 sections:

1. **SERP Ranking** - Searches Google for industry keywords, finds your position vs competitors, and identifies top competitors
2. **Deep Dive** - Scrapes competitor homepages as markdown and extracts value propositions, features, pricing, and trust signals using GPT
3. **AI Perception** - Queries ChatGPT, Perplexity, Grok, and Gemini to see if AI engines recommend your brand
4. **Deep Competitor Analysis** - Scrapes deeper pages (pricing, features) and generates consolidated company profiles with competitive comparison
5. **Executive Summary** - GPT-powered analysis compiling all findings into actionable insights

## Prerequisites

- **Bright Data Account** with:
  - SERP API zone configured
  - Web Unlocker zone configured
  - API token
- **OpenAI API Key** for GPT-powered analysis
- **Google Colab** (recommended) for running the notebook

## Setup

### Option 1: Google Colab (Recommended)

1. Upload the notebook to Google Colab
2. Add your API keys to Colab Secrets (click the key icon in the left sidebar):
   - `BRIGHTDATA_API_TOKEN` - Your Bright Data API token
   - `BRIGHTDATA_ZONE_SERP` - Your SERP API zone name (e.g., `serp_api1`)
   - `BRIGHTDATA_ZONE_UNLOCKER` - Your Web Unlocker zone name (e.g., `unlocker`)
   - `OPENAI_API_KEY` - Your OpenAI API key
3. Run the notebook cells in order

### Option 2: Local Jupyter

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your API keys
3. Install dependencies: `pip install requests openai`
4. Run the notebook

## Configuration

In the first code cell, enter your company details:

```python
MY_BRAND = "YourCompany"      # Your brand name
MY_DOMAIN = "yourcompany.com" # Your domain
COUNTRY = "us"                # Target country code
```

## Bright Data APIs Used

| API | Purpose |
|-----|---------|
| [SERP API](https://brightdata.com/products/serp-api) | Google search results with structured JSON output |
| [Web Unlocker](https://brightdata.com/products/web-unlocker) | Scrape any website as clean markdown |
| [Web Scraper API](https://brightdata.com/products/web-scraper) | Pre-built scrapers for AI engines (ChatGPT, Perplexity, Grok, Gemini) |

## Output

The notebook generates:
- SERP ranking analysis with competitor identification
- Structured insights from competitor homepages
- AI engine perception analysis (brand mention tracking)
- Consolidated company profiles with competitive comparison
- Executive report with strengths, weaknesses, and recommended actions

## License

MIT
