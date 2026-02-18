# 🗓️ MedFlow AI — Competition Roadmap

## Kaggle MedGemma Impact Challenge | Deadline: February 24, 2026

---

> [!CAUTION]
> **Today is Feb 13. We have exactly 11 days.** This roadmap is designed to ship a **competition-winning demo**, not a production system. Every decision is optimized for maximizing judging scores within the time constraint.

## Key Decisions (Locked In)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **AI Model** | MedGemma 27B only | 4B is underpowered; 27B handles both text + multimodal |
| **Model Serving** | Vertex AI (Cloud) | No GPU setup needed, instant access, reliable for demo |
| **Data** | Synthetic demo data | Ship fast; swap in real data post-competition |
| **Frontend** | Extend existing `cms-frontend` (Next.js) | 35+ components already built; don't start from scratch |
| **Backend** | Extend `followup-AI-backend-main` (Express/Prisma) | Schema + infra already scaffolded |

---

## What Judges Actually Score (Our Targeting Strategy)

```
┌─────────────────────────────────┬──────┬──────────────────────────────────────┐
│ Criteria                        │ Wt.  │ What We Must Show                   │
├─────────────────────────────────┼──────┼──────────────────────────────────────┤
│ Effective use of HAI-DEF models │ 20%  │ MedGemma 27B in 3+ distinct features│
│ Problem importance              │ 20%  │ Compelling story + real hospital pain│
│ Real-world impact               │ 20%  │ Quantified metrics in demo          │
│ Technical feasibility           │ 20%  │ Clean code + deployment docs        │
│ Execution & communication       │ 20%  │ Polished video + 3-page writeup     │
└─────────────────────────────────┴──────┴──────────────────────────────────────┘
```

---

## 📋 Staged Implementation Plan

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### STAGE 1: Foundation & AI Core (Feb 13-15, 3 days)
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Goal:** Backend talks to MedGemma 27B via Vertex AI. Chat works end-to-end.

#### Day 1 (Feb 13-14): Backend AI Integration
- [ ] Set up Vertex AI credentials + MedGemma 27B access
- [ ] Create `src/ai/medgemma/client.ts` — Vertex AI SDK wrapper
- [ ] Create `src/ai/medgemma/prompt-templates.ts` — Clinical system prompts
- [ ] Create `src/config/medgemma.config.ts` — Model config + env vars
- [ ] Verify: send a test clinical question → get MedGemma response

#### Day 2 (Feb 14-15): AI Chat Service
- [ ] Update Prisma schema — add `AIChatSession` + `AIChatMessage` tables
- [ ] Run migration
- [ ] Create `src/services/ai-chat.service.ts` — Chat logic with context management
- [ ] Create `src/controllers/ai-chat.controller.ts` — REST endpoints
- [ ] Create `src/routes/v1/ai.routes.ts` — Route definitions
- [ ] Wire routes into `app.ts`

#### Day 3 (Feb 15): Patient Context + Synthetic Data
- [ ] Create `src/services/health-history.service.ts` — Pull patient context for AI
- [ ] Create `prisma/seed-demo.ts` — Synthetic patients, visits, medical history
- [ ] Seed DB with 10 demo patients with realistic medical histories
- [ ] Test: Chat with patient context injection working

**Stage 1 Deliverable:** `/api/v1/ai/chat` endpoint works with MedGemma 27B, sessions persist, patient context flows into prompts.

---

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### STAGE 2: Triage + Imaging Analysis (Feb 15-17, 2 days)
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Goal:** Two killer features that showcase MedGemma's medical capabilities.

#### Day 4 (Feb 15-16): Smart Triage
- [ ] Create `src/services/triage.service.ts` — Symptom intake → ESI scoring
- [ ] Create `src/controllers/triage.controller.ts`
- [ ] Add `TriageAssessment` to Prisma schema + migrate
- [ ] Build triage prompt with structured JSON output
- [ ] Test: Submit symptoms → get ESI level + department routing + red flags

#### Day 5 (Feb 16-17): Medical Image Analysis
- [ ] Create `src/services/imaging.service.ts` — Image upload + MedGemma 27B analysis
- [ ] Create `src/controllers/imaging.controller.ts`
- [ ] Add `MedicalImage` + `ImagingAnalysis` to Prisma schema + migrate
- [ ] File upload endpoint (multer) + image storage
- [ ] Build radiology prompt for structured findings
- [ ] Test: Upload chest X-ray → get structured report with findings + urgency

**Stage 2 Deliverable:** Triage API scores symptoms with ESI levels. Imaging API generates radiology-style reports from uploaded medical images. Both use MedGemma 27B.

---

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### STAGE 3: Clinical Documentation + Timeline (Feb 17-19, 2 days)
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Goal:** Show AI automating clinical paperwork + a unified patient view.

#### Day 6 (Feb 17-18): AutoScribe — Clinical Doc Generation
- [ ] Create `src/services/clinical-docs.service.ts` — SOAP notes, discharge summaries
- [ ] Create `src/controllers/clinical.controller.ts`
- [ ] Add `ClinicalDocument` to schema + migrate
- [ ] SOAP note generation from visit conversation
- [ ] Discharge summary with patient-friendly version
- [ ] Test: Generate SOAP note + discharge summary for demo patient

#### Day 7 (Feb 18-19): Patient Health Timeline
- [ ] Create `src/services/timeline.service.ts` — Aggregate patient events
- [ ] Add `HealthTimelineEvent` to schema + migrate
- [ ] AI-powered trend detection (e.g., "BP rising over last 3 visits")
- [ ] Timeline API with chronological event stream
- [ ] Pre-populate timeline events from seed data

**Stage 3 Deliverable:** Clinical docs auto-generated from MedGemma. Patient timeline with AI insights shows longitudinal health view.

---

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### STAGE 4: Frontend Integration (Feb 19-21, 3 days)
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Goal:** Beautiful, working UI that ties everything together for the video demo.

#### Day 8 (Feb 19-20): Chat UI + Triage Interface
- [ ] AI Chat page — real-time conversation with typing indicators
- [ ] Chat sidebar — patient context panel (history, meds, allergies)
- [ ] Triage intake form — symptom input with severity sliders
- [ ] Triage result display — ESI badge, department routing, red flag alerts

#### Day 9 (Feb 20-21): Imaging + Documentation UI
- [ ] Image upload page with drag-and-drop
- [ ] Radiology report viewer — findings list, urgency badge, impression
- [ ] Side-by-side image + report layout
- [ ] Clinical docs page — generated SOAP notes with edit capability
- [ ] Discharge summary view — clinical + patient-friendly tabs

#### Day 10 (Feb 21): Dashboard + Timeline
- [ ] Patient timeline page — vertical event stream with AI insight cards
- [ ] Analytics dashboard — key metrics, AI activity summary
- [ ] Navigation between all features
- [ ] Dark mode, polished animations, responsive design

**Stage 4 Deliverable:** Full working frontend with all AI features connected and a premium, polished look.

---

### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
### STAGE 5: Demo Video + Submission (Feb 21-24, 3 days)
### ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Goal:** Ship the submission. Video, writeup, clean code.

#### Day 11 (Feb 21-22): Polish + Edge Cases
- [ ] End-to-end demo flow testing (chest pain scenario)
- [ ] Error handling + loading states
- [ ] Safety guardrails verification (emergency escalation, no diagnosis disclaimers)
- [ ] Clean up code, add comments, remove debug logs

#### Day 12 (Feb 22-23): Video + Technical Writeup
- [ ] Record 3-minute demo video following the demo scenario script
- [ ] Write 3-page technical overview PDF:
  - Page 1: Problem + impact (hospital workflow costs $200B/yr, burnout crisis)
  - Page 2: Architecture + MedGemma integration (system diagram, model usage)
  - Page 3: Results + deployment plan (demo metrics, edge deployment path)
- [ ] Clean README with one-command setup instructions

#### Day 13 (Feb 23-24): Final Submission
- [ ] Final testing of all features
- [ ] Package: video + writeup + source code
- [ ] Submit to Kaggle before deadline
- [ ] Celebrate 🎉

---

## 📊 Risk Mitigation

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Vertex AI quota limits | Medium | Request quota increase NOW; cache responses for demo |
| MedGemma 27B too slow for real-time chat | Medium | Use streaming (SSE); show typing indicator while generating |
| Frontend takes too long to polish | High | Use existing cms-frontend components; prioritize chat + triage UI |
| Image analysis quality is poor | Medium | Craft very detailed prompts; cherry-pick demo images |
| Run out of time on video | Low | Write demo script first (already done in PROJECT_STRUCTURE.md) |

---

## 🎯 Minimum Viable Submission (If Time Crunch)

If we fall behind, here's the **absolute minimum** that still wins:

| Priority | Feature | Judges See | Effort |
|----------|---------|-----------|--------|
| **P0** | AI Chat with patient context | MedGemma 27B in action | 2 days |
| **P0** | Smart Triage | Clinical reasoning showcase | 1 day |
| **P0** | Demo video + writeup | Execution quality | 2 days |
| **P1** | Medical image analysis | Multimodal capability | 1 day |
| **P1** | Frontend UI | Polish & communication | 2 days |
| **P2** | Clinical docs generation | Workflow automation | 1 day |
| **P2** | Patient timeline | Health history view | 1 day |

> [!IMPORTANT]
> **P0 features alone give us a strong submission.** P1 features make it competitive. P2 features make it a winner. We build in this order so we always have something submittable.

---

## 🔧 Daily Workflow

```
Each day:
  Morning  → Code the backend feature (service + controller + routes)
  Afternoon → Test API endpoints manually via curl/Postman
  Evening  → Commit, push, update this checklist
```

---

## Immediate Next Steps (Tonight)

1. **Set up Vertex AI** — Service account, enable MedGemma 27B API
2. **Create the AI client wrapper** — `src/ai/medgemma/client.ts`
3. **First MedGemma call** — Prove the model works from our backend
4. **Update `.env.example`** — Add Vertex AI config vars
