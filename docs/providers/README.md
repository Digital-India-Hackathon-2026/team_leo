# AI Providers — Index

All providers supported by PersonaCode. Add the API key to your repo-root `.env` to enable each one.

| Provider | Tier | Get Key | Free Quota | Notes |
|---|---|---|---|---|
| [Google AI Studio](./google-ai-studio.md) | 🆓 Free | [aistudio.google.com](https://aistudio.google.com/app/apikey) | 15 RPM · 1M TPM | Gemini 2.0 Flash; no credit card |
| [Groq](./groq.md) | 🆓 Free | [console.groq.com](https://console.groq.com/keys) | 30 RPM · 500K TPD | Llama 3, Mixtral; fastest inference |
| [Cerebras](./cerebras.md) | 🆓 Free | [cloud.cerebras.ai](https://cloud.cerebras.ai) | 30 RPM | Llama 3.1; ultra-fast wafer-scale |
| [OpenRouter](./openrouter.md) | 🆓 Freemium | [openrouter.ai/keys](https://openrouter.ai/keys) | $1 free credit | 100+ models; free tier with limits |
| [NVIDIA NIM](./nvidia-nim.md) | 🆓 Free | [build.nvidia.com](https://build.nvidia.com) | 1000 credits/mo | Llama, Mistral, Nemotron |
| [GitHub Models](./github-models.md) | 🆓 Free | [github.com/settings/tokens](https://github.com/settings/tokens) | Rate-limited | Needs GitHub account; PAT only |
| [OpenCode Zen](./opencode-zen.md) | 🆓 Free | [opencode.ai/zen](https://opencode.ai/zen) | Generous free tier | Built for code; fast |
| [Ollama](./ollama.md) | 🏠 Local | [ollama.com](https://ollama.com) | Unlimited | Runs locally; no key needed |

## Env var names

```bash
GOOGLE_AI_STUDIO_API_KEY=   # Google AI Studio
GROQ_API_KEY=               # Groq
CEREBRAS_API_KEY=           # Cerebras
OPENROUTER_API_KEY=         # OpenRouter
NVIDIA_NIM_API_KEY=         # NVIDIA NIM
GITHUB_TOKEN=               # GitHub Models
OPENCODE_ZEN_API_KEY=       # OpenCode Zen
OLLAMA_BASE_URL=http://localhost:11434/v1  # Ollama (local)
```

Set any of these in the repo-root `.env` to activate that provider. PersonaCode detects which providers are configured and makes them available for model selection.

## Choosing a provider

- **Just getting started?** → **Google AI Studio** (no credit card, best free quota)
- **Fastest responses?** → **Groq** or **Cerebras**
- **Most model variety?** → **OpenRouter**
- **Privacy / offline?** → **Ollama** (everything stays on your machine)
- **Already on GitHub?** → **GitHub Models** (use your existing PAT)

See each provider's guide for step-by-step signup and key-copy instructions.
