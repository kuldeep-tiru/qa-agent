# qa-agent 🧪
**A universal, local-first QA agent for freelance engagements.** Feed it a PDF requirement, a GitHub repo, or a demo/live URL — it analyzes requirements, generates test cases in your Excel template, runs web/API/manual/regression tests, attaches screenshot+video+trace evidence to defect drafts, performs RCA, and packages everything (with a portfolio README) for GitHub.

Runs entirely on your laptop. LLM = local Ollama (Qwen2.5), cost ₹0. Optional escalation to Anthropic via your own API key.

## Quickstart (Windows / PowerShell)
```powershell
# 1. One-time machine setup (Node 20+, Ollama, models, VS Code extensions)
.\scripts\setup-windows.ps1

# 2. Project setup
npm install
npm run doctor          # verify environment — every check should be [OK]

# 3. Create a client engagement
npm run qa-agent -- new clientx-shop
```

## Typical workflow (Week 2)
```powershell
npm run qa-agent -- validate saucedemo-pilot                    # check graph.json against the schema
npm run qa-agent -- generate saucedemo-pilot                    # graph -> Excel test cases in seconds (plain steps)
npm run qa-agent -- generate saucedemo-pilot --llm --limit 3    # refine steps with the local LLM, 3 new scenarios at a time
npx playwright install chromium                                 # one time: the browser used by tests (about 150 MB)
npm run qa-agent -- run auto saucedemo-pilot                    # run the Playwright specs; evidence and results.json are written per run
npm run qa-agent -- run auto saucedemo-pilot --demo-failure     # also run a deliberate failure to see screenshot, video, trace, HAR and console capture
```
Open `projects/saucedemo-pilot/test-cases/` in Excel, review and edit. Re-running never overwrites your file: it saves `-v2`, `-v3` ... unless you pass `--force`. LLM answers are cached per scenario in `knowledge/expansion-cache.json`.

Test runs write `projects/<name>/evidence/<runId>/<TestCaseId>/` (trace, plus screenshot, video, HAR, console log and page snapshot for failures) and `reports/results.json` keyed by Test Case Id. Spec titles must start with the Test Case Id, for example `TC_Auth_ValidLogin_001 Verify login...`. Use `--headed` to watch the browser and `--grep TC_Auth_ValidLogin_001` to run one test. Evidence is git-ignored by default; publish a run on purpose with `git add -f`.

## Roadmap (all modules stubbed from day 1)
| Week | Deliverable |
|---|---|
| 1 | Repo + CLI + LLM router + `doctor` ✅ |
| 2 | Excel writer + A2 Test Generation ✅ |
| 3 | PDF/URL/GitHub adapters + Requirement Graph |
| 4 | A3 Execution + Evidence capture |
| 5 | A8 Manual Runner |
| 6 | A5 RCA + A6 Defect Drafts |
| 7 | A7 Packaging + portfolio README + SauceDemo pilot |
| 8 | Regression suites + first live client pilot |

## Architecture
See `QA_Agent_System_Design.md` (agents A1–A8, contracts, folder layout).

## Commands
`doctor` · `new <name>` · `validate <project>` · `ingest` · `generate <project> [--force] [--llm] [--limit n]` · `run` · `rca` · `package`

Development: `npm run check` runs the typecheck and all tests. `npm run sample:excel` writes a sample test case workbook to `projects/saucedemo-pilot/test-cases/` so you can check the layout in Excel.

---
Built by Kuldeep Tiru — QA professional (manual, automation, API, AI-agent testing).
