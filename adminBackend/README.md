# Admin backend

FastAPI service for the desktop recording administration console.

- Reads canonical users, folders, recordings, and transcript segments from the mobile server's Prisma-backed internal API.
- Stores only admin sessions and admin Q&A messages in MySQL.
- Exposes browser endpoints under `/admin-api` so it does not conflict with the mobile `/api` routes.

Development:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8788 --reload
```

Copy `.env.example` to `.env` locally and set the same MySQL database used by `server`. Use a separate least-privilege database account and never commit `.env`.
