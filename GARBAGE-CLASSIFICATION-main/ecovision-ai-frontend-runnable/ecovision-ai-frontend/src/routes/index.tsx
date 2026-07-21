import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
});

type Prediction = {
  label: string;
  confidence: number; // 0..1
  probabilities?: Record<string, number>;
};

type HistoryItem = {
  id: string;
  imageDataUrl: string;
  label: string;
  confidence: number;
  timestamp: number;
};

const DISPOSAL_TIPS: Record<string, { tip: string; bin: string; emoji: string }> = {
  cardboard: { tip: "Flatten and keep dry. Recyclable curbside.", bin: "Recycling", emoji: "📦" },
  glass: { tip: "Rinse. Separate by color if required locally.", bin: "Glass recycling", emoji: "🍾" },
  metal: { tip: "Rinse cans. Aluminum & steel are highly recyclable.", bin: "Recycling", emoji: "🥫" },
  paper: { tip: "Keep clean and dry. Avoid greasy paper.", bin: "Recycling", emoji: "📄" },
  plastic: { tip: "Check the resin code. Rinse before recycling.", bin: "Recycling", emoji: "🧴" },
  trash: { tip: "Non-recyclable. Send to general waste.", bin: "General waste", emoji: "🗑️" },
  organic: { tip: "Compost when possible.", bin: "Compost", emoji: "🍎" },
  "e-waste": { tip: "Never bin. Use certified e-waste collection.", bin: "E-waste center", emoji: "🔌" },
};

function tipFor(label: string) {
  const key = label.toLowerCase();
  return (
    DISPOSAL_TIPS[key] ?? {
      tip: "Dispose according to your local municipal guidelines.",
      bin: "Check locally",
      emoji: "♻️",
    }
  );
}

function Index() {
  const [apiUrl, setApiUrl] = useState<string>("");
  const [apiUrlDraft, setApiUrlDraft] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Load persisted state
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ecovision.apiUrl") || "http://localhost:5000";
      setApiUrl(saved);
      setApiUrlDraft(saved);
      const h = localStorage.getItem("ecovision.history");
      if (h) setHistory(JSON.parse(h));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("ecovision.history", JSON.stringify(history.slice(0, 30)));
    } catch {}
  }, [history]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      // Give React a tick to render <video>
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (e: any) {
      setCameraError(e?.message || "Unable to access camera. Grant permission and try again.");
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(dataUrl);
    setPrediction(null);
    setError(null);
    stopCamera();
  }, [stopCamera]);

  const onFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCapturedImage(reader.result as string);
      setPrediction(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const reset = () => {
    setCapturedImage(null);
    setPrediction(null);
    setError(null);
  };

  const dataUrlToBlob = (dataUrl: string): Blob => {
    const [meta, b64] = dataUrl.split(",");
    const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "image/jpeg";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  const predict = useCallback(async () => {
    if (!capturedImage) return;
    if (!apiUrl) {
      setShowSettings(true);
      setError("Set your backend API URL first (top-right ⚙ Settings).");
      return;
    }
    setLoading(true);
    setError(null);
    setPrediction(null);
    try {
      const blob = dataUrlToBlob(capturedImage);
      const form = new FormData();
      form.append("image", blob, "capture.jpg");
      const endpoint = apiUrl.replace(/\/+$/, "") + "/predict";
      const res = await fetch(endpoint, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Backend responded ${res.status}`);
      const data = await res.json();
      // Accept common response shapes
      const label: string =
        data.label ?? data.class ?? data.prediction ?? data.result ?? "unknown";
      const confidenceRaw: number =
        data.confidence ?? data.probability ?? data.score ?? 0;
      const confidence = confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw;
      const probabilities: Record<string, number> | undefined =
        data.probabilities ?? data.probs ?? data.scores ?? undefined;
      const p: Prediction = { label: String(label), confidence, probabilities };
      setPrediction(p);
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          imageDataUrl: capturedImage,
          label: p.label,
          confidence: p.confidence,
          timestamp: Date.now(),
        },
        ...prev,
      ].slice(0, 30));
    } catch (e: any) {
      setError(e?.message || "Prediction failed. Check the backend URL & CORS.");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, capturedImage]);

  const stats = useMemo(() => {
    const total = history.length;
    const counts: Record<string, number> = {};
    let confSum = 0;
    for (const h of history) {
      counts[h.label] = (counts[h.label] ?? 0) + 1;
      confSum += h.confidence;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return {
      total,
      avgConf: total ? confSum / total : 0,
      topLabel: top?.[0] ?? "—",
      topCount: top?.[1] ?? 0,
    };
  }, [history]);

  const saveSettings = () => {
    const v = apiUrlDraft.trim();
    setApiUrl(v);
    try {
      localStorage.setItem("ecovision.apiUrl", v);
    } catch {}
    setShowSettings(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground text-lg shadow-sm">
              ♻️
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight sm:text-lg">EcoVision AI</h1>
              <p className="text-[11px] text-muted-foreground sm:text-xs">
                Smart Garbage Classification
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs sm:inline-flex ${
                apiUrl
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {apiUrl ? "Backend connected" : "Backend not set"}
            </span>
            <button
              onClick={() => setShowSettings((s) => !s)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              ⚙ Settings
            </button>
          </div>
        </div>
        {showSettings && (
          <div className="border-t border-border bg-card">
            <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
              <label className="mb-1 block text-sm font-medium">Backend API URL</label>
              <p className="mb-2 text-xs text-muted-foreground">
                Root URL of your Flask/FastAPI server. The app will POST images to{" "}
                <code className="rounded bg-muted px-1">/predict</code> as multipart form-data
                (field <code className="rounded bg-muted px-1">image</code>).
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={apiUrlDraft}
                  onChange={(e) => setApiUrlDraft(e.target.value)}
                  placeholder="https://your-backend.onrender.com"
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={saveSettings}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Hero */}
        <section className="mb-8 rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-accent/20 to-background p-6 sm:p-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-4xl">
            Classify waste in real time with AI 🌱
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Point your camera at an item or upload an image. Your trained CNN model will identify
            it and suggest the best way to dispose of it.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Capture Card */}
          <section className="lg:col-span-3 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
            <h3 className="mb-4 text-lg font-semibold">Capture or Upload</h3>

            <div className="relative aspect-video overflow-hidden rounded-xl border border-dashed border-border bg-muted">
              {capturedImage ? (
                <img
                  src={capturedImage}
                  alt="captured"
                  className="h-full w-full object-contain"
                />
              ) : cameraOn ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                  <div className="text-4xl">📷</div>
                  <p className="text-sm">
                    Start the camera or upload a photo to get started.
                  </p>
                  {cameraError && (
                    <p className="text-xs text-destructive">{cameraError}</p>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {!cameraOn && !capturedImage && (
                <button
                  onClick={startCamera}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  📹 Start camera
                </button>
              )}
              {cameraOn && (
                <>
                  <button
                    onClick={capture}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    📸 Capture
                  </button>
                  <button
                    onClick={stopCamera}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    Stop
                  </button>
                </>
              )}
              {!cameraOn && (
                <>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    ⬆ Upload image
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onFile(f);
                      e.target.value = "";
                    }}
                  />
                </>
              )}
              {capturedImage && (
                <>
                  <button
                    onClick={predict}
                    disabled={loading}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {loading ? "Classifying…" : "🔍 Classify"}
                  </button>
                  <button
                    onClick={reset}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    Retake
                  </button>
                </>
              )}
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </section>

          {/* Result Card */}
          <section className="lg:col-span-2 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
            <h3 className="mb-4 text-lg font-semibold">Prediction</h3>
            {loading && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Running model on your image…
              </div>
            )}
            {!loading && !prediction && (
              <p className="text-sm text-muted-foreground">
                Results will appear here after classification.
              </p>
            )}
            {prediction && (
              <div>
                {(() => {
                  const t = tipFor(prediction.label);
                  return (
                    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                      <div className="flex items-center gap-3">
                        <div className="text-3xl">{t.emoji}</div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">
                            Detected
                          </p>
                          <p className="text-xl font-bold capitalize">{prediction.label}</p>
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                          <span>Confidence</span>
                          <span>{(prediction.confidence * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${Math.min(100, prediction.confidence * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="mt-4 rounded-lg bg-background p-3 text-sm">
                        <p className="font-medium">Suggested bin: {t.bin}</p>
                        <p className="mt-1 text-muted-foreground">{t.tip}</p>
                      </div>
                    </div>
                  );
                })()}

                {prediction.probabilities && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      All classes
                    </p>
                    <ul className="space-y-2">
                      {Object.entries(prediction.probabilities)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => {
                          const pct = (v > 1 ? v : v * 100);
                          return (
                            <li key={k} className="text-xs">
                              <div className="mb-0.5 flex justify-between">
                                <span className="capitalize">{k}</span>
                                <span>{pct.toFixed(1)}%</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-primary/70"
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Dashboard */}
        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <StatCard label="Total classified" value={stats.total.toString()} emoji="📊" />
          <StatCard
            label="Avg. confidence"
            value={`${(stats.avgConf * 100).toFixed(1)}%`}
            emoji="🎯"
          />
          <StatCard
            label="Most common"
            value={stats.topLabel === "—" ? "—" : `${stats.topLabel} (${stats.topCount})`}
            emoji="🏷️"
            capitalize
          />
        </section>

        {/* History */}
        <section className="mt-8 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Recent classifications</h3>
            {history.length > 0 && (
              <button
                onClick={() => setHistory([])}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Clear history
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classifications yet.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {history.map((h) => {
                const t = tipFor(h.label);
                return (
                  <li
                    key={h.id}
                    className="flex gap-3 rounded-xl border border-border bg-background p-3"
                  >
                    <img
                      src={h.imageDataUrl}
                      alt={h.label}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold capitalize">
                        {t.emoji} {h.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(h.confidence * 100).toFixed(1)}% ·{" "}
                        {new Date(h.timestamp).toLocaleString()}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{t.bin}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Backend contract */}
        <section className="mt-8 rounded-2xl border border-dashed border-border bg-card/50 p-4 text-sm sm:p-6">
          <h3 className="mb-2 font-semibold">🔌 Backend contract (for your Flask/FastAPI server)</h3>
          <p className="text-muted-foreground">
            The frontend sends a <code className="rounded bg-muted px-1">POST</code> request to{" "}
            <code className="rounded bg-muted px-1">{`{API_URL}/predict`}</code> with{" "}
            <code className="rounded bg-muted px-1">multipart/form-data</code>, field name{" "}
            <code className="rounded bg-muted px-1">image</code>. Respond with JSON:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
{`{
  "label": "plastic",
  "confidence": 0.97,
  "probabilities": {
    "cardboard": 0.01, "glass": 0.00, "metal": 0.01,
    "paper": 0.00, "plastic": 0.97, "trash": 0.01
  }
}`}
          </pre>
          <p className="mt-3 text-muted-foreground">
            Enable CORS on your backend (e.g. <code className="rounded bg-muted px-1">flask-cors</code>).
            Load <code className="rounded bg-muted px-1">best_cnn_model.keras</code> once at
            startup for fast inference.
          </p>
        </section>

        <footer className="mt-10 pb-6 text-center text-xs text-muted-foreground">
          Built with EcoVision AI · Powered by your trained CNN model 🌍
        </footer>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  emoji,
  capitalize,
}: {
  label: string;
  value: string;
  emoji: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className="text-xl">{emoji}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold ${capitalize ? "capitalize" : ""}`}>{value}</p>
    </div>
  );
}
