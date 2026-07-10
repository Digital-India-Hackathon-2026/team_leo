# Cerebras — Provider Setup Guide

## Overview

| Detail | Value |
|---|---|
| **Provider** | Cerebras |
| **Free Tier** | ~1M tokens/day |
| **Credit Card Required** | No |
| **Best For** | Bulk work, Deep Research — big daily token budget |

## Step-by-Step Setup

### 1. Go to Cerebras Cloud

Navigate to [https://cloud.cerebras.ai/](https://cloud.cerebras.ai/)

### 2. Sign Up

- Click **"Sign Up"** or **"Get Started"**
- Sign up with your email or Google account
- No credit card is needed

### 3. Generate an API Key

1. After signing in, go to the **API Keys** section
2. Click **"Create API Key"**
3. Copy the generated key

### 4. Add to Personacode

Open your `.env` file in the project root and add:

```bash
CEREBRAS_API_KEY=your-api-key-here
```

### 5. Verify

```bash
pnpm dev
# Open http://localhost:3789/api/providers
# Cerebras should show configured: true
```

## Free Tier Details

- **Daily Budget**: ~1 million tokens per day
- **Models Available**: GPT-OSS 120B, ZAI GLM 4.7
- **Speed**: Fast inference on custom wafer-scale hardware
- **No rate limit per minute**, just a daily cap
- Ideal for longer tasks like Deep Research that consume many tokens

## Troubleshooting

- **"Quota exceeded"**: Daily limit reached — resets at midnight. The fallback chain handles this.
- **Model not found**: Cerebras rotates available models. Check the console for current model names.
