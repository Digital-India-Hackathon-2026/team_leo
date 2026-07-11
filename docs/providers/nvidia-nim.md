# NVIDIA NIM — Provider Setup Guide

## Overview

| Detail | Value |
|---|---|
| **Provider** | NVIDIA NIM (build.nvidia.com) |
| **Free Tier** | Free API credits on signup |
| **Credit Card Required** | No |
| **Best For** | Solid backup tier — Llama and Nemotron models |

## Step-by-Step Setup

### 1. Go to NVIDIA Build

Navigate to [https://build.nvidia.com/](https://build.nvidia.com/)

### 2. Sign Up

- Click **"Sign In"** or **"Join Now"**
- Create an NVIDIA account (email + password)
- No credit card is required

### 3. Get an API Key

1. After signing in, navigate to any model page (e.g., [Llama 3.3 70B](https://build.nvidia.com/meta/llama-3.3-70b-instruct))
2. Click **"Get API Key"** or look for the key in the code example panel
3. Copy the API key (starts with `nvapi-...`)

### 4. Add to Personacode

Open your `.env` file in the project root and add:

```bash
NVIDIA_API_KEY=nvapi-your-api-key-here
```

### 5. Verify

```bash
pnpm dev
# Open http://localhost:3789/api/providers
# NVIDIA should show configured: true
```

## Free Tier Details

- **Free Credits**: Provided on signup — no credit card
- **Models Available**: Llama 3.3 70B Instruct, Nemotron 70B Instruct
- **Speed**: Fast inference on NVIDIA's cloud GPUs
- Used as a backup tier in the fallback chain

## Troubleshooting

- **"Insufficient credits"**: Free credits may run out. The fallback chain handles this.
- **API key format**: Must start with `nvapi-`. If yours doesn't, re-generate from the model page.
