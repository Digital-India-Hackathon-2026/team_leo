# OpenRouter — Provider Setup Guide

## Overview

| Detail | Value |
|---|---|
| **Provider** | OpenRouter (:free models) |
| **Free Tier** | 20 RPM, 50 req/day (1000/day if you ever bought $10 credits) |
| **Credit Card Required** | No |
| **Best For** | Model variety — 27+ free models, great for Compare feature |

## Step-by-Step Setup

### 1. Go to OpenRouter

Navigate to [https://openrouter.ai/keys](https://openrouter.ai/keys)

### 2. Sign Up / Sign In

- Click **"Sign In"**
- Sign up with Google, GitHub, or email
- No credit card required for free models

### 3. Create an API Key

1. After signing in, go to **"Keys"** in the sidebar
2. Click **"Create Key"**
3. Name your key (e.g., "personacode")
4. Copy the generated key

### 4. Enable Free Models (IMPORTANT!)

> ⚠️ **Critical Step**: You must enable the data/privacy setting or `:free` model calls will return 402 errors.

1. Go to **Account Settings** → **Privacy**
2. Enable **"Allow my prompts to be used for model improvement"**
3. This is required for all `:free` model access

### 5. Add to Personacode

Open your `.env` file in the project root and add:

```bash
OPENROUTER_API_KEY=your-api-key-here
```

### 6. Verify

```bash
pnpm dev
# Open http://localhost:3789/api/providers
# OpenRouter should show configured: true
```

## Free Tier Details

- **Rate Limits**: 20 requests per minute
- **Daily Requests**: 50/day (1000/day if you've ever purchased $10+ credits)
- **Models Available**: 27+ free models including GPT-OSS, Qwen 3 Coder, Llama 3.3 70B
- Free models are identified by the `:free` suffix (e.g., `openai/gpt-oss-120b:free`)
- Models rotate — some may become unavailable while new ones are added

## Troubleshooting

- **402 Payment Required**: Enable the privacy/data setting (step 4 above)
- **Model unavailable**: Free models rotate. Check [openrouter.ai/models](https://openrouter.ai/models) for current free models
- **Rate limits**: 20 RPM is strict — the fallback chain handles overflow
