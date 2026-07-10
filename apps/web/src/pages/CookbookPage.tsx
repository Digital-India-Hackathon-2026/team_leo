import { useState, useMemo } from "react";

type Recipe = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  category: Category;
  model: string;
  tags: string[];
};

type Category = "code" | "writing" | "analysis" | "creative" | "devops" | "research";

const CATEGORY_META: Record<Category, { icon: string; label: string; color: string }> = {
  code: { icon: "💻", label: "Code", color: "var(--accent)" },
  writing: { icon: "✍️", label: "Writing", color: "#e05eff" },
  analysis: { icon: "📊", label: "Analysis", color: "var(--accent2)" },
  creative: { icon: "🎨", label: "Creative", color: "#ff6b9d" },
  devops: { icon: "⚙️", label: "DevOps", color: "var(--warn)" },
  research: { icon: "🔬", label: "Research", color: "var(--plan)" },
};

const RECIPES: Recipe[] = [
  {
    id: "r1",
    title: "Explain & Refactor",
    description: "Get a clear explanation of complex code and a cleaner version with modern patterns.",
    prompt: "Explain this code step by step, then refactor it using modern TypeScript patterns with proper error handling and types:\n\n```\n// paste your code here\n```",
    category: "code",
    model: "google/gemini-2.5-flash",
    tags: ["refactor", "typescript", "explanation"],
  },
  {
    id: "r2",
    title: "Write Unit Tests",
    description: "Generate comprehensive unit tests for a function or module with edge cases.",
    prompt: "Write comprehensive unit tests for the following code. Include happy-path tests, edge cases, error scenarios, and boundary conditions. Use the testing framework already in the project (or suggest one if none exists):\n\n```\n// paste your code here\n```",
    category: "code",
    model: "google/gemini-2.5-flash",
    tags: ["testing", "tdd", "quality"],
  },
  {
    id: "r3",
    title: "Code Review",
    description: "Get a thorough code review with actionable feedback on bugs, performance, and style.",
    prompt: "Review this code like a senior engineer. Check for:\n- Bugs and logic errors\n- Performance issues\n- Security vulnerabilities\n- Code style and readability\n- Missing error handling\n\nProvide specific, actionable feedback with fixed code snippets:\n\n```\n// paste your code here\n```",
    category: "code",
    model: "groq/llama-3.3-70b-versatile",
    tags: ["review", "quality", "security"],
  },
  {
    id: "r4",
    title: "Technical Blog Post",
    description: "Turn a technical concept into an engaging blog post with examples.",
    prompt: "Write a technical blog post about [TOPIC]. Include:\n- An engaging introduction that hooks the reader\n- Clear explanations with code examples\n- Diagrams described in text (I'll visualize later)\n- Practical tips and common pitfalls\n- A conclusion with next steps\n\nTone: informative but conversational. Length: 1000-1500 words.",
    category: "writing",
    model: "openrouter/google/gemini-2.5-flash:free",
    tags: ["blog", "technical writing", "content"],
  },
  {
    id: "r5",
    title: "README Generator",
    description: "Generate a professional README.md from your project structure.",
    prompt: "Analyze this project and generate a professional README.md with:\n- Project name and badge suggestions\n- Concise description (what it does, why it matters)\n- Quick start guide with installation steps\n- Usage examples with code snippets\n- API reference (if applicable)\n- Contributing guidelines\n- License section\n\nProject files:\n// paste your file tree or key files here",
    category: "writing",
    model: "google/gemini-2.5-flash",
    tags: ["documentation", "readme", "open source"],
  },
  {
    id: "r6",
    title: "Data Analysis Pipeline",
    description: "Design a data analysis workflow from raw data to insights.",
    prompt: "I have a dataset with the following columns: [DESCRIBE YOUR DATA]\n\nDesign a complete analysis pipeline:\n1. Data cleaning and validation steps\n2. Exploratory data analysis (what to look for)\n3. Statistical tests or models to apply\n4. Visualization recommendations\n5. Code to implement each step (Python/pandas preferred)\n\nFormat the output as a step-by-step guide with code.",
    category: "analysis",
    model: "cerebras/llama-4-scout-17b-16e-instruct",
    tags: ["data science", "pipeline", "statistics"],
  },
  {
    id: "r7",
    title: "API Design Review",
    description: "Evaluate your REST API design for best practices and suggest improvements.",
    prompt: "Review this REST API design for best practices:\n\n[PASTE YOUR API ENDPOINTS]\n\nCheck for:\n- RESTful naming conventions\n- Proper HTTP methods and status codes\n- Pagination and filtering patterns\n- Error response format consistency\n- Authentication/authorization patterns\n- Versioning strategy\n- Rate limiting considerations\n\nSuggest improvements with examples.",
    category: "analysis",
    model: "groq/llama-3.3-70b-versatile",
    tags: ["api", "rest", "architecture"],
  },
  {
    id: "r8",
    title: "Creative Brainstorm",
    description: "Generate creative ideas for product features, names, or marketing angles.",
    prompt: "I'm building [DESCRIBE YOUR PROJECT]. Brainstorm:\n\n1. **5 unique feature ideas** that would delight users\n2. **3 catchy tagline options** (under 8 words each)\n3. **2 unconventional marketing angles** for developer communities\n4. **1 viral demo idea** that would get attention on social media\n\nBe creative and specific — no generic suggestions.",
    category: "creative",
    model: "openrouter/google/gemini-2.5-flash:free",
    tags: ["brainstorm", "product", "marketing"],
  },
  {
    id: "r9",
    title: "Docker + CI/CD Setup",
    description: "Generate a production-ready Dockerfile and CI/CD pipeline for your project.",
    prompt: "Create a production-ready setup for a [LANGUAGE/FRAMEWORK] project:\n\n1. **Multi-stage Dockerfile** (build + runtime, minimal image size)\n2. **docker-compose.yml** for local development\n3. **GitHub Actions workflow** for CI/CD:\n   - Lint + typecheck + test on PR\n   - Build + push Docker image on merge to main\n   - Deploy step (placeholder for your platform)\n4. **.dockerignore** file\n\nInclude comments explaining each decision.",
    category: "devops",
    model: "google/gemini-2.5-flash",
    tags: ["docker", "ci/cd", "github actions"],
  },
  {
    id: "r10",
    title: "Deep Research Report",
    description: "Investigate a topic thoroughly and produce a structured report with sources.",
    prompt: "Research [TOPIC] and produce a structured report:\n\n## Requirements\n- **Scope**: Cover the current state, key players, technical approaches, and future trends\n- **Depth**: Include technical details, not just surface-level summaries\n- **Structure**: Executive summary → Background → Current state → Analysis → Recommendations → Sources\n- **Length**: 2000-3000 words\n- **Citations**: Note where information would need verification\n\nFocus on accuracy and nuance. Flag any uncertain claims.",
    category: "research",
    model: "cerebras/llama-4-scout-17b-16e-instruct",
    tags: ["research", "report", "deep dive"],
  },
  {
    id: "r11",
    title: "Debug Helper",
    description: "Systematically diagnose and fix a bug with root cause analysis.",
    prompt: "Help me debug this issue:\n\n**What I expected**: [describe expected behavior]\n**What actually happens**: [describe actual behavior]\n**Error message** (if any):\n```\n[paste error]\n```\n**Relevant code**:\n```\n[paste code]\n```\n\nPlease:\n1. Identify the likely root cause\n2. Explain WHY it's happening\n3. Provide a fix with code\n4. Suggest how to prevent similar issues",
    category: "code",
    model: "groq/llama-3.3-70b-versatile",
    tags: ["debugging", "troubleshooting", "fix"],
  },
  {
    id: "r12",
    title: "Performance Audit",
    description: "Analyze code for performance bottlenecks and optimization opportunities.",
    prompt: "Perform a performance audit on this code:\n\n```\n[paste code]\n```\n\nAnalyze:\n1. **Time complexity** of key operations (Big-O)\n2. **Memory usage** patterns and potential leaks\n3. **I/O bottlenecks** (database queries, network calls, file ops)\n4. **Caching opportunities**\n5. **Parallelization potential**\n\nFor each issue found, provide an optimized version with benchmarking suggestions.",
    category: "analysis",
    model: "google/gemini-2.5-flash",
    tags: ["performance", "optimization", "audit"],
  },
];

const MODEL_RECOMMENDATIONS = [
  {
    provider: "Google AI Studio",
    model: "gemini-2.5-flash",
    strengths: "Best all-rounder. Fast, great at code, large context window (1M tokens). Generous free tier.",
    badge: "free",
    best: ["Code generation", "Analysis", "Long documents"],
  },
  {
    provider: "Groq",
    model: "llama-3.3-70b-versatile",
    strengths: "Fastest inference. Great for interactive coding sessions and quick iterations.",
    badge: "free",
    best: ["Fast responses", "Code review", "Debugging"],
  },
  {
    provider: "Cerebras",
    model: "llama-4-scout-17b-16e-instruct",
    strengths: "Extremely fast inference with good reasoning. Large context for research tasks.",
    badge: "free",
    best: ["Research", "Long context", "Fast iteration"],
  },
  {
    provider: "OpenRouter",
    model: "google/gemini-2.5-flash:free",
    strengths: "Access to many models through one API. Free tier models available.",
    badge: "freemium",
    best: ["Model variety", "Fallback option", "Experimentation"],
  },
  {
    provider: "Ollama (Local)",
    model: "Various",
    strengths: "Runs entirely on your machine. Complete privacy. No rate limits.",
    badge: "local",
    best: ["Privacy-sensitive work", "Offline use", "Unlimited usage"],
  },
];

const ALL_CATEGORIES = Object.keys(CATEGORY_META) as Category[];

export default function CookbookPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return RECIPES.filter((r) => {
      const matchesCat = activeCategory === "all" || r.category === activeCategory;
      const matchesSearch =
        !search ||
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.description.toLowerCase().includes(search.toLowerCase()) ||
        r.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
      return matchesCat && matchesSearch;
    });
  }, [search, activeCategory]);

  function copyPrompt(recipe: Recipe) {
    navigator.clipboard.writeText(recipe.prompt).then(() => {
      setCopiedId(recipe.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  const badgeClass = (badge: string) =>
    badge === "free" ? "cb-badge-free" : badge === "freemium" ? "cb-badge-freemium" : "cb-badge-local";

  return (
    <div className="cookbook-page">
      <div className="cookbook-header">
        <h2>📖 Cookbook</h2>
        <p className="cookbook-subtitle">
          Ready-to-use prompt recipes and model recommendations for common tasks.
          Copy a prompt, paste it into chat, and customize the placeholders.
        </p>
      </div>

      {/* Search and filters */}
      <div className="cookbook-controls">
        <input
          className="cookbook-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search recipes…"
        />
        <div className="cookbook-categories">
          <button
            className={`cookbook-cat ${activeCategory === "all" ? "on" : ""}`}
            onClick={() => setActiveCategory("all")}
          >
            All
          </button>
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`cookbook-cat ${activeCategory === cat ? "on" : ""}`}
              onClick={() => setActiveCategory(cat)}
              style={
                activeCategory === cat
                  ? { borderColor: CATEGORY_META[cat].color, color: CATEGORY_META[cat].color }
                  : undefined
              }
            >
              {CATEGORY_META[cat].icon} {CATEGORY_META[cat].label}
            </button>
          ))}
        </div>
      </div>

      {/* Recipes grid */}
      {filtered.length > 0 ? (
        <div className="cookbook-grid">
          {filtered.map((recipe) => {
            const catMeta = CATEGORY_META[recipe.category];
            const isExpanded = expandedId === recipe.id;
            return (
              <div key={recipe.id} className="cookbook-card">
                <div className="cookbook-card-top">
                  <span className="cookbook-card-cat" style={{ color: catMeta.color }}>
                    {catMeta.icon} {catMeta.label}
                  </span>
                  <span className="cookbook-card-model" title={recipe.model}>
                    ◈ {recipe.model.split("/").pop()}
                  </span>
                </div>
                <h3 className="cookbook-card-title">{recipe.title}</h3>
                <p className="cookbook-card-desc">{recipe.description}</p>

                <button
                  className="cookbook-card-expand"
                  onClick={() => setExpandedId(isExpanded ? null : recipe.id)}
                >
                  {isExpanded ? "Hide prompt ▴" : "Show prompt ▾"}
                </button>

                {isExpanded && (
                  <pre className="cookbook-card-prompt">{recipe.prompt}</pre>
                )}

                <div className="cookbook-card-footer">
                  <div className="cookbook-card-tags">
                    {recipe.tags.map((t) => (
                      <span key={t} className="cookbook-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  <button
                    className={`cookbook-copy ${copiedId === recipe.id ? "copied" : ""}`}
                    onClick={() => copyPrompt(recipe)}
                  >
                    {copiedId === recipe.id ? "✓ Copied!" : "📋 Copy prompt"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cookbook-empty">
          <p>No recipes match your search.</p>
        </div>
      )}

      {/* Model recommendations */}
      <div className="cookbook-models-section">
        <h3>🏆 Model Recommendations</h3>
        <p className="cookbook-models-hint">
          Which free model to use for which task? Here's our guide.
        </p>
        <div className="cookbook-models-grid">
          {MODEL_RECOMMENDATIONS.map((m) => (
            <div key={m.model} className="cookbook-model-card">
              <div className="cookbook-model-top">
                <span className="cookbook-model-provider">{m.provider}</span>
                <span className={`cookbook-model-badge ${badgeClass(m.badge)}`}>{m.badge}</span>
              </div>
              <div className="cookbook-model-name">{m.model}</div>
              <p className="cookbook-model-desc">{m.strengths}</p>
              <div className="cookbook-model-best">
                <span className="cookbook-model-best-label">Best for:</span>
                {m.best.map((b) => (
                  <span key={b} className="cookbook-model-best-tag">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ollama local setup */}
      <div className="cookbook-ollama-section">
        <h3>🦙 Run Models Locally with Ollama</h3>
        <p className="cookbook-ollama-hint">
          For complete privacy and unlimited usage, run models on your own hardware.
        </p>
        <div className="cookbook-ollama-steps">
          <div className="cookbook-step">
            <span className="cookbook-step-num">1</span>
            <div>
              <strong>Install Ollama</strong>
              <p>
                Download from{" "}
                <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">
                  ollama.com
                </a>
              </p>
            </div>
          </div>
          <div className="cookbook-step">
            <span className="cookbook-step-num">2</span>
            <div>
              <strong>Pull a model</strong>
              <pre className="cookbook-step-code">ollama pull llama3.2</pre>
            </div>
          </div>
          <div className="cookbook-step">
            <span className="cookbook-step-num">3</span>
            <div>
              <strong>Set in .env</strong>
              <pre className="cookbook-step-code">OLLAMA_BASE_URL=http://localhost:11434/v1</pre>
            </div>
          </div>
          <div className="cookbook-step">
            <span className="cookbook-step-num">4</span>
            <div>
              <strong>Select in chat</strong>
              <p>Pick your Ollama model from the model picker in the composer bar.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
