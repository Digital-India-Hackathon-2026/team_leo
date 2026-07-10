# Git basics for Dev B & Dev C (5-minute read)

One-time setup after Dev A shares the GitHub repo link (Day 1):

```bash
git clone <repo-url> personacode
cd personacode
pnpm install
cp .env.example .env        # fill in only what your package needs
git checkout -b web         # Dev B — or: git checkout -b channels  (Dev C)
```

Daily loop (do this every ~1-2 hours of work):

```bash
git add .
git commit -m "web: compare view columns"   # short, present tense, prefix with your package
git push -u origin web                      # first push; later just: git push
```

Getting Dev A's latest merges (do this at every sync, ~2× a day):

```bash
git pull origin main
```

If `git pull` reports a conflict: STOP, don't guess — ping Dev A. (Conflicts should
basically never happen because you only edit files inside your own package.)

Rules:
- Never push to `main` — only your own branch. Dev A merges.
- Never commit `.env` (it's git-ignored; keep it that way).
- Commit small and often — a broken half-feature on your branch is fine, a day of unpushed work is not.
