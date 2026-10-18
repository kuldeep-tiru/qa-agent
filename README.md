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

## Roadmap (all modules stubbed from day 1)
| Week | Deliverable |
|---|---|
| 1 | Repo + CLI + LLM router + `doctor` ✅ |
| 2 | Excel writer + A2 Test Generation |
| 3 | PDF/URL/GitHub adapters + Requirement Graph |
| 4 | A3 Execution + Evidence capture |
| 5 | A8 Manual Runner |
| 6 | A5 RCA + A6 Defect Drafts |
| 7 | A7 Packaging + portfolio README + SauceDemo pilot |
| 8 | Regression suites + first live client pilot |

## Architecture
See `QA_Agent_System_Design.md` (agents A1–A8, contracts, folder layout).

## Commands
`doctor` · `new <name>` · `ingest` · `generate` · `run` · `rca` · `package`

---
Built by Kuldeep Tiru — QA professional (manual, automation, API, AI-agent testing).
