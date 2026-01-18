# Competitive Visibility Audit

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/ScrapeAlchemist/Competitive-Visibility-Audit/blob/main/Competitive_Visibility_Audit.ipynb)

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

## Setup

1. Click the "Open in Colab" badge above (or [this link](https://colab.research.google.com/github/ScrapeAlchemist/Competitive-Visibility-Audit/blob/main/Competitive_Visibility_Audit.ipynb))
2. Add your API keys to Colab Secrets:
   - Click the **🔑 key icon** in the left sidebar
   - Add each secret and toggle **"Notebook access"** on:

   | Secret Name | Description |
   |-------------|-------------|
   | `BRIGHTDATA_API_TOKEN` | Your Bright Data API token |
   | `BRIGHTDATA_ZONE_SERP` | SERP API zone name (e.g., `serp_api1`) |
   | `BRIGHTDATA_ZONE_UNLOCKER` | Web Unlocker zone name (e.g., `unlocker`) |
   | `OPENAI_API_KEY` | Your OpenAI API key |

3. Run the notebook cells in order

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
