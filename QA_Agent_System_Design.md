# Universal QA Agent — System Design Document
**Owner:** Kuldeep Tiru | **Platform:** Windows 11, VS Code, PowerShell | **Stack:** Node.js + TypeScript + Playwright + Ollama
**Repo:** `kuldeep-tiru/qa-agent` (public portfolio) | **Version:** 1.1

---

## 1. Vision & Constraints

A personal, laptop-run QA agent that takes **any freelance assignment** (PDF requirement, GitHub repo link, or live/demo URL) and produces: requirement analysis, test cases in your Excel template, automated + manual + API + regression execution, evidence-backed defect drafts, RCA, and a portfolio-ready ZIP with README for GitHub.

**Hard constraints (from your answers):**
- Budget ≈ ₹0 → **Ollama (local) is the primary brain**; Anthropic free web chat is a *manual escalation path* only (copy-paste tough questions)
- No JIRA/Confluence/Figma/Qase → Excel + markdown for everything
- 16GB RAM → local models capped at 7B–8B
- Beginner in TS/Playwright/RAG → you drive via CLI prompts and review outputs; agent code is scaffolded for maintainability
- Tight freelance timelines (days, not weeks) → optimize for **fast per-project cold start**

---

## 2. Honest Limitation to Accept Upfront

A local 7B model is **not** as sharp as Claude at deep reasoning. Design response:
- RCA Agent is **evidence-driven, template-based**: it matches failure signatures against known patterns (rule layer) and only then asks the LLM to summarize the hypothesis. This makes a small model effective.
- For genuinely hard RCA, the agent **exports a compact RCA brief** you paste into Claude web chat (free) and paste the answer back. This "human escalation port" is a first-class feature, not a hack.

---

## 3. Architecture

```
┌──────────────────────── INPUT ADAPTERS ────────────────────────┐
│  PDF parser (pdf-parse) │ URL crawler (Playwright) │ Git clone │
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
┌────────────────── REQUIREMENT GRAPH BUILDER ───────────────────┐
│  Modules → Features → Scenarios → Acceptance Criteria (JSON)     │
│  Each node = "workflow node": id, type, preconditions, triggers│
└──────────────────────────────┬─────────────────────────────────┘
                               ▼
┌─────────────────────── AGENT ORCHESTRATOR ─────────────────────┐
│  LLM Router: Ollama (primary) ── escalation port ── Claude web │
│                                                                │
│  A1 Onboarding/Req-Analysis   A5 RCA Agent                     │
│  A2 Test Generation → Excel   A6 Defect Draft Agent            │
│  A3 Execution Agent           A7 Packaging Agent (+README)     │
│  A4 Evidence Agent            A8 Manual Test Runner            │
└──────────┬───────────────────────┬─────────────────────────────┘
           ▼                       ▼
   Playwright (web+API)    KB: ChromaDB + SQLite
   video/trace/screenshot  (req docs, past defects,
   HAR per failure          RCA patterns, test history)
```

**"Nodes and triggers" realized:** the Requirement Graph *is* the node system. Each scenario node carries preconditions + trigger events; the Execution Agent turns nodes into Playwright tests, and the Manual Runner turns them into an interactive checklist.

---

## 4. Per-Project Flow (the freelance loop)

1. `npx qa-agent new "ClientX-Shop"` → scaffold `projects/clientx-shop/`
2. `qa-agent ingest ./requirements.pdf` (or `--url https://demo-site` / `--repo github-link`)
3. Crawl site / read PDF → build requirement graph → **you review** `graph.json` (`qa-agent validate <project>` checks it against the schema)
4. `qa-agent generate` → fills **your Excel template** (Functional + Regression sheets), drafts ready for your review
5. You edit/approve in Excel
6. `qa-agent run auto` → Playwright executes automatable cases; evidence (screenshot + video-on-failure + trace + HAR) bundled per defect
7. `qa-agent run manual` → opens an HTML checklist runner in browser; you mark Pass/Fail, add screenshots
8. Failures → RCA Agent → defect draft (markdown + row appended to **Defects** sheet: id, severity, steps, evidence links)
9. You approve defects → final Excel + evidence ZIP
10. `qa-agent package` → ZIP with code + reports + generated **README.md** (portfolio format) → GitHub upload

---

## 5. Key Technical Decisions

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 20+) | One language for agents + generated tests |
| Browser/API automation | **Playwright only** (incl. `APIRequestContext` for API tests) | Beginner-friendly; Postman collections optional import later — avoid two tools now |
| LLM primary | Ollama: `qwen2.5:7b-instruct` (structured output), `nomic-embed-text` (embeddings) | Best small model for JSON-following; runs fine in 16GB |
| LLM escalation | BYOK slot in config (`ANTHROPIC_API_KEY`) + manual Claude-web port | Zero cost now, upgrade path later |
| Vector DB | ChromaDB (embedded) | Simple, persistent, local |
| Excel | `exceljs` — writes into **your template file**, preserving layout | Matches your exact columns incl. Step 01–04 multi-row structure |
| CLI | `commander` | `qa-agent <command>` ergonomics |
| Scheduling | PowerShell scripts first; **n8n later** as visual workflow layer | Don't add n8n complexity on day 1 |
| Evidence policy | Trace always; video **on-failure only** (disk safety); screenshots on failure + on manual-test capture | 321GB free disk won't survive full-suite video |
| Live-site safety | Read-only flows; disposable emails/phones; **no load testing on production**; gentle crawl rate | Client trust + legality |
| Schema validation | Zod, strict objects | Typos in hand-written `graph.json` fail loudly; the same schemas validate LLM output |
| Tests | Node built-in test runner (`npm test`) | No extra dependency |
| Regenerating test cases | Never overwrite an edited Excel file; write a versioned copy unless `--force` | You review and edit in Excel, so a silent overwrite would lose work |
| Test Type column | Column M of `Functional Testing`; values come from the 22 types on the `Coverage` sheet | Coverage counts by type |

---

## 6. Repository Structure

```
qa-agent/
├── README.md                  ← master portfolio README
├── package.json
├── config/agent.config.json   ← LLM endpoints, evidence policy
├── src/
│   ├── cli/                   ← commands
│   ├── adapters/              ← pdf, crawler, git, graph-file (graph.json loader)
│   ├── domain/                ← graph and test-type schemas (pure, no I/O)
│   ├── agents/                ← A1–A8, orchestrator, llm-router
│   ├── knowledge/             ← chromadb client, embeddings
│   ├── runners/               ← playwright, manual-checklist
│   ├── excel/                 ← template writer (exceljs)
│   ├── evidence/              ← screenshot/video/trace/HAR bundler
│   └── packaging/             ← zip + README generator
├── templates/
│   ├── QA Test Case Template.xlsx   ← your master template
│   ├── defect-report.md.tmpl
│   └── readme-portfolio.md.tmpl
└── projects/
    └── <client-project>/      ← one folder per freelance engagement
        ├── requirements/      ← raw PDFs/notes
        ├── graph.json         ← requirement graph (reviewable)
        ├── test-cases/        ← filled Excel
        ├── tests/             ← generated Playwright specs
        ├── evidence/          ← screenshots/videos/traces/HAR
        ├── defects/           ← markdown drafts + defect Excel
        └── reports/           ← summary HTML/markdown
```

---

## 7. Agent Contracts (summary)

- **A2 Test Generation:** input = approved `graph.json` + your Excel template → output = filled Excel (TC IDs like `TC_<Module>_<Scenario>_001`, Requirement # mapped to doc sections, Priority heuristic: login/payment/checkout = High) Priority, Status and Test Type are written once per case, on the first row of each block.
- **A3 Execution:** runs `tests/`, never deletes evidence, writes `results.json` keyed by Test Case Id (traceability)
- **A5 RCA:** input = failure bundle (trace + console + HAR + last screenshot) → pattern-match known signatures (5xx, selector-not-found, timeout-after-redirect, console-error…) → LLM writes hypothesis + suggested fix → confidence score; low confidence ⇒ export `rca-brief.md` for Claude-web escalation
- **A6 Defect Draft:** one markdown per defect + Defects sheet row; **never auto-final** — status stays `Draft` until you approve
- **A7 Packaging:** zips `projects/<x>/` per .gitignore-style rules (exclude videos >50MB optionally), generates portfolio README (overview, coverage stats, tools, how-to-run, defect highlights)

---

## 8. Build Order (all modules stubbed day 1, hardened in sequence)

| Week | Deliverable | Exit criteria |
|---|---|---|
| 1 | Repo + CLI skeleton + config + LLM router (Ollama ping) | `qa-agent new` scaffolds a project |
| 2 | Excel writer + A2 Test Generation (from a hand-written graph.json) | Excel output matches your template columns |
| 3 | Adapters: PDF ingest + URL crawl → graph builder | Feed SauceDemo URL → get scenario graph |
| 4 | A3 Execution + Evidence (Playwright, video-on-fail, trace) | Runs generated login tests, bundles evidence |
| 5 | A8 Manual Runner + results merge | Full loop: generate → execute → results.json |
| 6 | A5 RCA + A6 Defect Drafts | Failure produces defect draft with evidence |
| 7 | A7 Packaging + portfolio README | SauceDemo pilot end-to-end + GitHub publish |
| 8 | Regression sheet logic + first real freelance pilot | Regression suite reruns from Excel |

**Phase 1 pilot target:** SauceDemo → then AutomationIntesting (fake e-commerce with API) → then first live client project.

---

## 9. Success Metrics

- Cold start on new project (URL → reviewed Excel): < 1 hour
- ≥ 60% of generated test cases accepted with light edits
- Every defect has evidence bundle attached
- Every project ships with portfolio-ready GitHub README
- Monthly API cost: ₹0 (Ollama only)
