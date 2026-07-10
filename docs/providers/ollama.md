# Ollama (Local) — Provider Setup Guide

## Overview

| Detail | Value |
|---|---|
| **Provider** | Ollama (local) |
| **Free Tier** | Unlimited & offline |
| **Credit Card Required** | No |
| **Best For** | Privacy mode, offline use, Cookbook feature — final fallback that never dies |

## Step-by-Step Setup

### 1. Install Ollama

Navigate to [https://ollama.com/download](https://ollama.com/download) and download for your OS:

**macOS**:
```bash
# Via Homebrew
brew install ollama

# Or download the macOS app from ollama.com
```

**Linux**:
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

**Windows**:
- Download the installer from [ollama.com/download](https://ollama.com/download)
- Run the installer and follow the prompts

### 2. Start the Ollama Server

```bash
ollama serve
```

This starts the API server at `http://localhost:11434`.

### 3. Pull a Model

Download at least one model:

```bash
# Recommended starter — small and fast
ollama pull qwen3:4b

# Good general-purpose model
ollama pull llama3.2:3b

# Better quality (needs 8+ GB RAM)
ollama pull llama3.1:8b
```

### 4. Add to Personacode

Open your `.env` file in the project root and add (usually already set):

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1
```

### 5. Verify

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Start Personacode
pnpm dev
# Open http://localhost:3789/api/providers
# Ollama should show configured: true
```

## Hardware Requirements

| Model Size | Min RAM | Examples |
|---|---|---|
| ≤ 3B params | 4 GB | qwen3:0.6b, llama3.2:1b, llama3.2:3b |
| 4–8B params | 8 GB | qwen3:4b, llama3.1:8b, phi4-mini |
| 12–14B params | 16 GB | gemma3:12b, qwen3:14b |
| 32B+ params | 24+ GB | qwen3:32b |
| 70B+ params | 48+ GB | llama3.3:70b (or GPU with 48GB+ VRAM) |

> 💡 Use the **Cookbook** feature (`/cookbook` in the CLI or Cookbook page in the web app) to automatically detect your hardware and get personalized model recommendations!

## Why Use Ollama

- **100% offline** — no internet needed, no data leaves your machine
- **Unlimited tokens** — no rate limits, no daily caps
- **Privacy** — perfect for sensitive codebases
- **Final fallback** — when all cloud providers are down, Ollama keeps working
- **Cookbook** — helps you find the best model for your hardware

## Troubleshooting

- **"Connection refused"**: Make sure `ollama serve` is running
- **Slow inference**: Try a smaller model (qwen3:4b is fastest)
- **Out of memory**: Pull a smaller model variant or close other applications
- **Model not found**: Run `ollama list` to see installed models; `ollama pull <name>` to add one
