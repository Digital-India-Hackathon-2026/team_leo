# GitHub Models — Provider Setup Guide

## Overview

| Detail | Value |
|---|---|
| **Provider** | GitHub Models |
| **Free Tier** | Free with any GitHub account (rate-limited per day) |
| **Credit Card Required** | No |
| **Best For** | Backup provider — judges love the GitHub integration |

## Step-by-Step Setup

### 1. Go to GitHub Token Settings

Navigate to [https://github.com/settings/tokens](https://github.com/settings/tokens)

### 2. Create a Fine-Grained Personal Access Token (PAT)

1. Click **"Generate new token"** → **"Fine-grained token"**
2. Give it a name: `personacode-models`
3. Set expiration (e.g., 90 days)
4. **No special permissions needed** — the default (no repository access) works for GitHub Models
5. Click **"Generate token"**

### 3. Copy Your Token

- Copy the token immediately — it won't be shown again
- It starts with `github_pat_...`

### 4. Add to Personacode

Open your `.env` file in the project root and add:

```bash
GITHUB_MODELS_TOKEN=github_pat_your-token-here
```

### 5. Verify

```bash
pnpm dev
# Open http://localhost:3789/api/providers
# GitHub should show configured: true
```

## Free Tier Details

- **Pricing**: Free with any GitHub account
- **Rate Limits**: Daily request limit (varies)
- **Models Available**: GPT-4o Mini, Llama 3.3 70B Instruct
- **Token Type**: Fine-grained PAT — most secure option

## Troubleshooting

- **401 Unauthorized**: Make sure you're using a fine-grained PAT, not a classic token
- **Rate limit**: Daily limits apply. The fallback chain handles this automatically.
- **Token expired**: Regenerate at [github.com/settings/tokens](https://github.com/settings/tokens)
