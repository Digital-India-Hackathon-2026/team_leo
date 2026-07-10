import * as si from "systeminformation";

/**
 * Cookbook backend — detects hardware and recommends local models.
 *
 * Uses `systeminformation` to detect RAM/CPU/GPU, then filters a static
 * model catalog to recommend models that will run well. Each recommendation
 * includes the `ollama pull <model>` command.
 */

export interface HardwareInfo {
  ram: { totalGB: number; freeGB: number };
  cpu: { brand: string; cores: number; speedGHz: number };
  gpu: { model: string; vramMB: number }[];
}

export interface ModelRecommendation {
  name: string;
  parameterSize: string;
  quantization: string;
  minRAM: string;
  pullCommand: string;
  notes: string;
  tier: "tiny" | "small" | "medium" | "large";
}

/** Static fallback catalog — used when Ollama API is not reachable. */
const MODEL_CATALOG: ModelRecommendation[] = [
  // Tiny models (< 4GB RAM)
  {
    name: "qwen3:0.6b",
    parameterSize: "0.6B",
    quantization: "Q4_K_M",
    minRAM: "2 GB",
    pullCommand: "ollama pull qwen3:0.6b",
    notes: "Ultra-lightweight, good for simple completions and testing",
    tier: "tiny",
  },
  {
    name: "llama3.2:1b",
    parameterSize: "1B",
    quantization: "Q4_K_M",
    minRAM: "2 GB",
    pullCommand: "ollama pull llama3.2:1b",
    notes: "Meta's smallest Llama — fast inference, basic tasks",
    tier: "tiny",
  },
  // Small models (4–8 GB RAM)
  {
    name: "qwen3:4b",
    parameterSize: "4B",
    quantization: "Q4_K_M",
    minRAM: "4 GB",
    pullCommand: "ollama pull qwen3:4b",
    notes: "Great quality-to-size ratio, strong at coding and reasoning",
    tier: "small",
  },
  {
    name: "llama3.2:3b",
    parameterSize: "3B",
    quantization: "Q4_K_M",
    minRAM: "4 GB",
    pullCommand: "ollama pull llama3.2:3b",
    notes: "Solid general-purpose model, good for chat and code",
    tier: "small",
  },
  {
    name: "phi4-mini",
    parameterSize: "3.8B",
    quantization: "Q4_K_M",
    minRAM: "4 GB",
    pullCommand: "ollama pull phi4-mini",
    notes: "Microsoft's compact model — excellent at reasoning",
    tier: "small",
  },
  // Medium models (8–16 GB RAM)
  {
    name: "llama3.1:8b",
    parameterSize: "8B",
    quantization: "Q4_K_M",
    minRAM: "8 GB",
    pullCommand: "ollama pull llama3.1:8b",
    notes: "Best balance of speed and quality for most tasks",
    tier: "medium",
  },
  {
    name: "qwen3:8b",
    parameterSize: "8B",
    quantization: "Q4_K_M",
    minRAM: "8 GB",
    pullCommand: "ollama pull qwen3:8b",
    notes: "Strong coding model with tool-use support",
    tier: "medium",
  },
  {
    name: "gemma3:12b",
    parameterSize: "12B",
    quantization: "Q4_K_M",
    minRAM: "10 GB",
    pullCommand: "ollama pull gemma3:12b",
    notes: "Google's latest — strong reasoning and instruction following",
    tier: "medium",
  },
  // Large models (16+ GB RAM or GPU with VRAM)
  {
    name: "qwen3:14b",
    parameterSize: "14B",
    quantization: "Q4_K_M",
    minRAM: "16 GB",
    pullCommand: "ollama pull qwen3:14b",
    notes: "Excellent coding and reasoning, needs decent hardware",
    tier: "large",
  },
  {
    name: "qwen3:32b",
    parameterSize: "32B",
    quantization: "Q4_K_M",
    minRAM: "24 GB",
    pullCommand: "ollama pull qwen3:32b",
    notes: "Near frontier-level quality — needs 24GB+ RAM or GPU VRAM",
    tier: "large",
  },
  {
    name: "llama3.3:70b",
    parameterSize: "70B",
    quantization: "Q4_K_M",
    minRAM: "48 GB",
    pullCommand: "ollama pull llama3.3:70b",
    notes: "Top-tier open model — needs high-end hardware or GPU",
    tier: "large",
  },
];

/** Detect system hardware using systeminformation. */
export async function detectHardware(): Promise<HardwareInfo> {
  try {
    const [mem, cpu, graphics] = await Promise.all([
      si.mem(),
      si.cpu(),
      si.graphics(),
    ]);

    return {
      ram: {
        totalGB: Math.round(mem.total / (1024 ** 3) * 10) / 10,
        freeGB: Math.round(mem.available / (1024 ** 3) * 10) / 10,
      },
      cpu: {
        brand: cpu.brand,
        cores: cpu.physicalCores,
        speedGHz: cpu.speed,
      },
      gpu: (graphics.controllers ?? []).map((g) => ({
        model: g.model,
        vramMB: g.vram ?? 0,
      })),
    };
  } catch (err) {
    console.error("[cookbook] hardware detection failed:", (err as Error).message);
    return {
      ram: { totalGB: 0, freeGB: 0 },
      cpu: { brand: "unknown", cores: 0, speedGHz: 0 },
      gpu: [],
    };
  }
}

/** Filter the model catalog based on detected hardware. */
function filterModels(hw: HardwareInfo): ModelRecommendation[] {
  const totalRAM = hw.ram.totalGB;
  const maxVRAMGB = Math.max(0, ...hw.gpu.map((g) => g.vramMB)) / 1024;

  // Effective memory: GPU VRAM is used for inference if a discrete GPU is present
  const effectiveGB = maxVRAMGB > 2 ? Math.max(totalRAM, maxVRAMGB) : totalRAM;

  // Filter each model by its minRAM string (parsed to a number), with a 10% headroom buffer
  return MODEL_CATALOG.filter((m) => {
    const minGB = parseFloat(m.minRAM); // e.g. "16 GB" → 16
    return effectiveGB >= minGB * 0.9;  // 10% headroom so "16 GB system" gets 16 GB models
  });
}

/** Try fetching locally installed models from Ollama. */
async function getOllamaModels(): Promise<string[]> {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL?.replace("/v1", "") ?? "http://localhost:11434";
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export interface CookbookResult {
  hardware: HardwareInfo;
  recommendations: ModelRecommendation[];
  installedModels: string[];
  summary: string;
}

/**
 * Main cookbook function: detect hardware → filter models → check installed → return recommendations.
 */
export async function getCookbookRecommendations(): Promise<CookbookResult> {
  const [hardware, installedModels] = await Promise.all([
    detectHardware(),
    getOllamaModels(),
  ]);

  const recommendations = filterModels(hardware);

  const gpuInfo = hardware.gpu.length > 0
    ? hardware.gpu.map((g) => `${g.model} (${g.vramMB} MB VRAM)`).join(", ")
    : "none detected";

  const summary = [
    `System: ${hardware.cpu.brand} (${hardware.cpu.cores} cores @ ${hardware.cpu.speedGHz} GHz)`,
    `RAM: ${hardware.ram.totalGB} GB total, ${hardware.ram.freeGB} GB available`,
    `GPU: ${gpuInfo}`,
    `Ollama: ${installedModels.length > 0 ? `${installedModels.length} model(s) installed` : "not running or no models"}`,
    `Recommended: ${recommendations.length} models for your hardware`,
  ].join("\n");

  return { hardware, recommendations, installedModels, summary };
}
