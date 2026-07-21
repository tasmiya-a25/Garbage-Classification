# EcoVision AI — Quick Start

This project has two parts that run separately: a React/TanStack Start frontend
and a Python FastAPI backend that serves the Keras garbage-classifier model.

## 1. Frontend

```bash
npm install
npm run dev
```

Open the URL it prints (defaults to whatever port Vite picks, typically
http://localhost:8080 or http://localhost:5173).

> Note: `vite.config.ts` in this zip has one small fix applied — an explicit
> `server: { host: "0.0.0.0", port: 8080 }` override. This was needed to get
> the dev server running in a sandboxed Linux container that didn't support
> binding to `::` (IPv6 any-address), which is the tool's default. On your own
> machine this override is harmless — it'll just serve on 0.0.0.0:8080. Feel
> free to remove it if you'd rather let Vite auto-pick a port/host.

## 2. Backend

```bash
cd backend
python -m venv venv

# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate

pip install -r requirements.txt
python app.py
```

This starts the FastAPI server on **http://localhost:5000** and loads
`fine_tuned_garbage_classifier.keras` from the project root.

Verify it's working:
```bash
curl http://localhost:5000/
# {"status":"healthy","model_loaded":true,"classes":[...]}
```

## 3. Connect them

Open the frontend in your browser, click the ⚙ Settings icon (top-right),
and confirm the "Backend API URL" is set to `http://localhost:5000`
(this is the default, so usually nothing to change). Then upload an image
and click predict.

## Tested & verified

Both servers were built and run-tested end-to-end before packaging:
- Backend: model loads successfully, `/predict` returns real classification
  results (e.g. label + confidence + per-class probabilities).
- Frontend: dev server builds and serves the app (HTTP 200).

## Notes
- Backend requires TensorFlow — first `pip install` can take a few minutes
  and needs ~1-2 GB of disk space.
- Model file (`fine_tuned_garbage_classifier.keras`) is ~24 MB and is
  included in this zip.
