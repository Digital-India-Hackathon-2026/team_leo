# Groq — Provider Setup Guide

## Overview

| Detail | Value |
|---|---|
| **Provider** | Groq |
| **Free Tier** | ~30 RPM, daily token caps |
| **Credit Card Required** | No |
| **Best For** | Fastest inference — used for quick calls & Auto-mode routing |

## Step-by-Step Setup

### 1. Go to Groq Console

Navigate to [https://console.groq.com/keys](https://console.groq.com/keys)

### 2. Sign Up / Sign In

- Click **"Sign Up"** if you don't have an account
- You can sign up with Google, GitHub, or email
- No credit card is required

### 3. Create an API Key

1. In the sidebar, click **"API Keys"**
2. Click **"Create API Key"**
3. Give your key a name (e.g., "personacode")
4. Click **"Submit"**

### 4. Copy Your Key

- Your API key will be displayed **only once**
- Copy it immediately and store it securely

### 5. Add to Personacode

Open your `.env` file in the project root and add:

```bash
GROQ_API_KEY=your-api-key-here
```

### 6. Verify

```bash
pnpm dev
# Open http://localhost:3789/api/providers
# Groq should show configured: true
```

## Free Tier Details

- **Rate Limits**: ~30 requests per minute
- **Daily Token Caps**: Varies by model
- **Models Available**: Llama 3.3 70B, Qwen 3 32B, Llama 3.1 8B Instant
- **Speed**: Groq is the **fastest** inference provider — ~320 tokens/second
- Used for quick single-turn calls and Auto-mode task classification

## Troubleshooting

- **"Rate limit exceeded"**: Groq has strict per-minute limits. The fallback chain handles this automatically.
- **Daily cap reached**: Resets at midnight UTC. Other providers in the chain take over.
