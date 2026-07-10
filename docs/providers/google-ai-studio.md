# Google AI Studio (Gemini) — Provider Setup Guide

## Overview

| Detail | Value |
|---|---|
| **Provider** | Google AI Studio (Gemini) |
| **Free Tier** | ~10-60 RPM depending on model, 1M-token context |
| **Credit Card Required** | No |
| **Best For** | Default brain — best free model with huge context window |

## Step-by-Step Setup

### 1. Go to Google AI Studio

Navigate to [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### 2. Sign In

- Sign in with your Google account
- If you don't have one, create a free Google account first

### 3. Create an API Key

1. Click **"Create API Key"**
2. Select your Google Cloud project (or create a new one — it's free)
3. Your API key will be generated and displayed

### 4. Copy Your Key

- Click the **copy icon** next to your API key
- Keep this key safe — don't share it publicly!

### 5. Add to Personacode

Open your `.env` file in the project root and add:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your-api-key-here
```

### 6. Verify

Start the server and check the provider is configured:

```bash
pnpm dev
# Open http://localhost:3789/api/providers
# Google should show configured: true
```

## Free Tier Details

- **Rate Limits**: ~10-60 requests per minute depending on the model
- **Context Window**: Up to 1 million tokens
- **Models Available**: Gemini Flash (latest), Gemini Flash Lite
- **No daily token cap** on most models
- This is the **highest priority** provider in the fallback chain

## Tips

- Use the `-latest` model aliases to always get the newest version
- Gemini Flash is the best default for both speed and quality
- The 1M context window means you can work with very large codebases

## Troubleshooting

- **"API key not valid"**: Make sure you copied the full key, check for extra spaces
- **Rate limit errors (429)**: The fallback chain will automatically switch to Groq or another provider
- **Region restrictions**: Some regions may have limited access — check [Google AI availability](https://ai.google.dev/available_regions)
