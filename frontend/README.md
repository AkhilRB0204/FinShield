# FinShield frontend

Vite + React, plain CSS. Read [DESIGN.md](DESIGN.md) before building anything.

```bash
npm install
cp .env.example .env   # points at a local API on :8000
npm run dev
```

`VITE_API_URL` is read at build time. On Vercel, changing it takes effect on the next deploy.
