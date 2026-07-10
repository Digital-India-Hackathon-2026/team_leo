import { useState, useEffect, useCallback } from "react";

type GalleryItem = {
  id: string;
  prompt: string;
  url: string;
  createdAt: number;
  width: number;
  height: number;
};

type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3";
const ASPECT_RATIOS: Record<AspectRatio, { w: number; h: number; label: string }> = {
  "1:1": { w: 768, h: 768, label: "Square" },
  "16:9": { w: 1024, h: 576, label: "Landscape" },
  "9:16": { w: 576, h: 1024, label: "Portrait" },
  "4:3": { w: 896, h: 672, label: "Standard" },
};

const STORAGE_KEY = "personacode-gallery";

function loadGallery(): GalleryItem[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveGallery(items: GalleryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

const INSPIRATION = [
  "A futuristic city skyline at sunset with flying cars",
  "A cozy cabin in a snowy forest with warm light glowing from windows",
  "An astronaut floating in space painting on a canvas",
  "A steampunk clockwork owl perched on ancient books",
  "A crystal cave with bioluminescent mushrooms and a underground lake",
  "A cyberpunk street market at night with neon signs in the rain",
];

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[]>(loadGallery);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<GalleryItem | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    saveGallery(items);
  }, [items]);

  const generate = useCallback(async () => {
    const text = prompt.trim();
    if (!text || generating) return;
    setGenerating(true);
    setError("");

    const { w, h } = ASPECT_RATIOS[ratio];
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?width=${w}&height=${h}&seed=${Date.now()}&nologo=true`;

    try {
      // Pre-load the image to verify it works
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image generation failed. Try a different prompt."));
        img.src = url;
        // Timeout after 60s
        setTimeout(() => reject(new Error("Generation timed out. Try again.")), 60000);
      });

      const item: GalleryItem = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt: text,
        url,
        createdAt: Date.now(),
        width: w,
        height: h,
      };
      setItems((prev) => [item, ...prev]);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [prompt, ratio, generating]);

  function deleteItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (lightbox?.id === id) setLightbox(null);
  }

  function clearAll() {
    if (items.length === 0) return;
    setItems([]);
    setLightbox(null);
  }

  function useInspiration() {
    const pick = INSPIRATION[Math.floor(Math.random() * INSPIRATION.length)];
    setPrompt(pick);
  }

  const filtered = filter
    ? items.filter((i) => i.prompt.toLowerCase().includes(filter.toLowerCase()))
    : items;

  return (
    <div className="gallery-page">
      <div className="gallery-header">
        <div>
          <h2>🖼 Image Gallery</h2>
          <p className="gallery-subtitle">
            Generate images with AI — powered by{" "}
            <a href="https://pollinations.ai" target="_blank" rel="noopener noreferrer">
              Pollinations.ai
            </a>{" "}
            (free, no API key needed)
          </p>
        </div>
        {items.length > 0 && (
          <button className="gallery-clear" onClick={clearAll}>
            🗑 Clear all
          </button>
        )}
      </div>

      {/* Generation form */}
      <div className="gallery-form">
        <div className="gallery-prompt-row">
          <textarea
            className="gallery-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image you want to create…"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                generate();
              }
            }}
          />
          <button
            className="gallery-generate"
            onClick={generate}
            disabled={generating || !prompt.trim()}
          >
            {generating ? (
              <span className="gallery-spinner">⟳</span>
            ) : (
              "✦ Generate"
            )}
          </button>
        </div>
        <div className="gallery-options">
          <div className="gallery-ratios">
            {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map((r) => (
              <button
                key={r}
                className={`gallery-ratio ${ratio === r ? "on" : ""}`}
                onClick={() => setRatio(r)}
              >
                <span className="ratio-label">{r}</span>
                <span className="ratio-name">{ASPECT_RATIOS[r].label}</span>
              </button>
            ))}
          </div>
          <button className="gallery-inspire" onClick={useInspiration} title="Random prompt idea">
            🎲 Inspire me
          </button>
        </div>
      </div>

      {error && <div className="gallery-error">⚠ {error}</div>}

      {/* Loading skeleton */}
      {generating && (
        <div className="gallery-generating">
          <div className="gallery-skel-card">
            <div className="gallery-skel-img">
              <span className="gallery-skel-spinner">✦</span>
              <span className="gallery-skel-text">Generating image…</span>
            </div>
            <div className="gallery-skel-prompt">{prompt}</div>
          </div>
        </div>
      )}

      {/* Filter */}
      {items.length > 2 && (
        <input
          className="gallery-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="🔍 Filter by prompt…"
        />
      )}

      {/* Gallery grid */}
      {filtered.length > 0 ? (
        <div className="gallery-grid">
          {filtered.map((item) => (
            <div key={item.id} className="gallery-card">
              <div className="gallery-img-wrap" onClick={() => setLightbox(item)}>
                <img src={item.url} alt={item.prompt} loading="lazy" />
                <div className="gallery-overlay">
                  <span>🔍 View</span>
                </div>
              </div>
              <div className="gallery-card-info">
                <p className="gallery-card-prompt" title={item.prompt}>
                  {item.prompt}
                </p>
                <div className="gallery-card-actions">
                  <span className="gallery-card-size">
                    {item.width}×{item.height}
                  </span>
                  <a
                    className="gallery-download"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in new tab"
                  >
                    ↗
                  </a>
                  <button
                    className="gallery-delete"
                    onClick={() => deleteItem(item.id)}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 && !generating ? (
        <div className="gallery-empty">
          <div className="gallery-empty-icon">✦</div>
          <p>No images yet</p>
          <p className="gallery-empty-hint">
            Type a prompt above and hit Generate to create your first image.
          </p>
        </div>
      ) : filter && filtered.length === 0 ? (
        <p className="gallery-empty-hint" style={{ textAlign: "center", padding: 24 }}>
          No images match your filter.
        </p>
      ) : null}

      {/* Lightbox */}
      {lightbox && (
        <div className="gallery-lightbox" onClick={() => setLightbox(null)}>
          <div className="gallery-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button className="gallery-lightbox-close" onClick={() => setLightbox(null)}>
              ✕
            </button>
            <img src={lightbox.url} alt={lightbox.prompt} />
            <div className="gallery-lightbox-info">
              <p>{lightbox.prompt}</p>
              <div className="gallery-lightbox-meta">
                <span>
                  {lightbox.width}×{lightbox.height}
                </span>
                <a
                  href={lightbox.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gallery-lightbox-dl"
                >
                  ↗ Open full size
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
