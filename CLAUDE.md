# FinShield

Transaction fraud detection system. Backend lives in `backend/` (FastAPI, Python).

## Non-negotiable principles

- **The detection engine is deterministic, and its numbers are load-bearing.** Same input, same
  score, every time. Risk scores, flag severities, weights, and level thresholds drive real
  decisions — never approximate, round away, or "smooth" them, and never introduce randomness
  or model calls into the scoring path.
- **An LLM explains decisions; it never makes them.** The Anthropic client may only turn an
  already-computed `RiskAssessment` into human-readable language. It must not change a score,
  add or remove flags, pick a risk level, or decide an outcome. If the LLM is unavailable,
  detection still works.
- **Rule weights live in a registry, as data.** Do not hard-code weights inside rule logic. A
  future tuning agent will read the registry and propose weight changes, so the registry must stay
  a plain, serializable, inspectable structure.
- **The evaluation harness is callable as a function.** It must run in-process with no CLI or
  file side effects required, taking a registry (or weights) plus a dataset and returning metrics.
  The tuning agent will call it as a verification tool for its proposals.

## User-facing text

- **Never show a snake_case identifier to a user.** Rule names, enum values, and field names
  (e.g. `card_testing`, `gift_cards`) must be mapped to human labels ("Card testing",
  "Gift cards") before display — in API responses meant for display, UI copy, and LLM output.
- **Never state that a transaction is fraud.** The system assesses risk; it does not render
  verdicts. Say "high risk", "flagged for review", "consistent with card-testing patterns" — never
  "this is fraud" or "fraudulent transaction". This applies to LLM explanations too; the prompt
  must enforce it. (The `is_fraud` field on synthetic data is ground truth for evaluation only and
  is never surfaced to users.)

## Layout

- `backend/app/models.py` — domain models (`Transaction`, `UserProfile`, `FraudFlag`, `RiskAssessment`).
- `backend/app/generator.py` — deterministic synthetic dataset generator (`generate_dataset`).

## Dev

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```
