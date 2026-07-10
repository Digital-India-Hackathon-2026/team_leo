# OpenCode Zen — Provider Setup Guide

## Overview

| Detail | Value |
|---|---|
| **Provider** | OpenCode Zen |
| **Free Tier** | Rotating launch-window $0 models (roster changes often) |
| **Credit Card Required** | No |
| **Best For** | Optional extra coding model — low priority in fallback chain |

## Step-by-Step Setup

### 1. Go to OpenCode Zen

Navigate to [https://opencode.ai/zen](https://opencode.ai/zen)

### 2. Sign Up

- Create an account on OpenCode
- No credit card is required for free-rotation models

### 3. Get an API Key

1. After signing in, find the **API Keys** section
2. Generate a new key
3. Copy it

### 4. Add to Personacode

Open your `.env` file in the project root and add:

```bash
OPENCODE_ZEN_API_KEY=your-api-key-here
```

### 5. Verify

```bash
pnpm dev
# Open http://localhost:3789/api/providers
# Zen should show configured: true
```

## Free Tier Details

- **Pricing**: Rotating $0 models during launch windows
- **Models**: Changes frequently — currently includes Gemini 3 Flash, Claude Haiku 4.5
- **Important**: Most Zen models are **paid** — verify a model is in the free rotation before relying on it
- Low priority in the fallback chain due to model availability uncertainty

## ⚠️ Important Notes

- The free model roster **changes often** — a model that's free today might be paid tomorrow
- Always check the Zen dashboard for current free models
- This provider is best used as a bonus, not as a primary provider
- If a model returns a billing error, the fallback chain will move to the next provider

## Troubleshooting

- **402 errors**: The model may have left the free rotation. Check the Zen dashboard.
- **Model not found**: Model names change. Verify current names at [opencode.ai/zen](https://opencode.ai/zen).
