# FinShield

FinShield is fraud detection for people and small businesses who have been priced out of
enterprise security tooling. The backend lives in `backend/` (FastAPI, Python) and the
frontend in `frontend/` (Vite, React). Please read `frontend/DESIGN.md` before making any
change to the frontend; it explains the visual decisions and why they were made.

## How the system works

FinShield has two detection engines. The first scores transactions against each customer's
behavioral baseline: their usual amounts, categories, hours and locations. The second screens
messages, such as emails and texts, for the patterns that phishing and fraudulent
communications tend to share.

The two engines are built on one architecture, and that is deliberate. In both, rules fire as
weighted indicators, the indicators' points add up to a score between 0 and 100, and the same
constrained language-model layer explains the result. When you add a capability, fit it into
this architecture rather than building a parallel copy of it. If a shared component seems to
need changing before it can accept one engine's output, treat that as a sign the abstraction
is wrong, and fix the abstraction rather than the component.

## Principles we do not compromise on

**Detection is deterministic, and its numbers matter.** The same input must produce the same
score every time. Scores, severities, weights and level thresholds drive real decisions for
real people, so they are never approximated, rounded away or smoothed, and nothing random and
no model call ever enters the scoring path.

**The language model explains; it never decides.** It receives only the indicators that fired
and the score that has already been computed. It may not change a score, add or remove an
indicator, choose a risk level or decide an outcome. If the model is unavailable, detection
carries on as normal and a deterministic explanation is shown in its place.

**The query interface answers only from what its tools return.** It looks up data and runs the
engines through tools, and it never states a figure that did not come from one of them. When
the tools cannot answer a question, it says so plainly instead of guessing.

**Rule weights live in registries, as data.** Weights, thresholds and phrase lists belong in
the registries, never inside rule logic. A tuning agent will eventually read these registries
and propose changes to them, so they need to remain plain, serializable structures that anyone
can inspect.

**The evaluation harness can be called as a function.** It runs in-process, without needing a
command line or writing files, takes a registry (or a set of weights) and a dataset, and
returns metrics. The tuning agent will rely on it to check its own proposals.

## Routes

The application has exactly three routes, and new features belong inside one of them rather
than on a page of their own. Please do not add routes.

| Route           | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `/`             | An overview of FinShield and a live demonstration             |
| `/transactions` | The transaction table and the query interface                 |
| `/check`        | Analyze a transaction, screen a message, or upload a CSV file |

## Writing for the people who use it

**Never show a snake_case identifier to a user.** Rule names, enum values, field names, tool
names and ids such as `card_testing`, `gift_cards`, `search_transactions` and `user_009` must
be mapped to readable labels ("Card testing", "Gift cards", "Search transactions",
"Customer 009") before anyone sees them. This applies to API responses intended for display,
to interface copy, and to everything a language model writes.

**Never state that something is fraud.** FinShield assesses risk; it does not deliver
verdicts, whether about a transaction or a message. Describe what the assessment found: "high
risk", "flagged for review", "consistent with card-testing patterns", "matches the pattern of
an account-suspension notice". Avoid "this is fraud", "fraudulent" and "this is a phishing
email". Every prompt we send to a model must hold it to the same standard.

The `is_fraud` field in the synthetic data is ground truth for evaluation and nothing else. It
is never shown to a user and never sent to a model.

## Where things live

The backend modules are all in `backend/app/`:

| Module                                        | Responsibility                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `models.py`                                   | Domain models: `Transaction`, `UserProfile`, `FraudFlag`, `RiskAssessment`, `ExplanationSubject` |
| `scoring.py`                                  | Turns flags into a score for both engines: summed points, compound multiplier, cap |
| `rules.py`, `detection.py`                    | The transaction registry and the rules that read it                             |
| `message_rules.py`, `message_detection.py`    | The message registry and the rules that read it                                 |
| `explainer.py`                                | The explanation layer. Each engine describes its own subject, so the explainer never needs to know which engine produced the flags |
| `ask.py`                                      | The query interface's tools and tool-use loop                                   |
| `generator.py`                                | The deterministic synthetic dataset (`generate_dataset`)                        |
| `repository.py`                               | Data access                                                                     |
| `main.py`                                     | The API routes                                                                  |

## Running it locally

To run the backend:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

An `ANTHROPIC_API_KEY` in `backend/.env` is optional. Without one, detection works exactly the
same and explanations fall back to their deterministic form.

To run the frontend:

```bash
cd frontend
npm install
npm run dev
```

The frontend reads the API address from `VITE_API_URL` and uses `http://localhost:8000` by
default during development.
