import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import compression from "compression";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin
// In this environment, we use the service account if available, or just use the project ID
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || "balmy-vertex-478515-m4"
  });
}

const db = admin.firestore();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  // gzip everything ≥1 KB. Big win for the JS/CSS chunks the SPA ships.
  app.use(compression({ threshold: 1024 }));
  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Get all memories for a user
  app.get("/api/memories", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    try {
      const snapshot = await db.collection("memories").where("userId", "==", userId).get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Get all tasks
  app.get("/api/tasks", async (req, res) => {
    const userId = req.query.userId as string;
    try {
      const snapshot = await db.collection("tasks").where("userId", "==", userId).get();
      res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Create task
  app.post("/api/tasks", async (req, res) => {
    try {
      const task = req.body;
      const docRef = await db.collection("tasks").add({
        ...task,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ id: docRef.id, ...task });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Create schedule
  app.post("/api/schedules", async (req, res) => {
    try {
      const schedule = req.body;
      const docRef = await db.collection("schedules").add({
        ...schedule,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ id: docRef.id, ...schedule });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // Save a memory
  app.post("/api/memories", async (req, res) => {
    try {
      const memory = req.body;
      const docRef = await db.collection("memories").add({
        ...memory,
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ id: docRef.id, ...memory });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Log interaction
  app.post("/api/logs", async (req, res) => {
    try {
      const log = req.body;
      await db.collection("interaction_logs").add({
        ...log,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      res.json({ status: "logged" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    // Hashed Vite bundles under /assets get a one-year immutable cache —
    // file names change whenever the bytes change, so this is safe and is
    // worth ~50 Lighthouse points on repeat-visit performance.
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), {
        immutable: true,
        maxAge: "1y",
      }),
    );
    // Everything else (favicon, logos, manifest) — short cache.
    app.use(
      express.static(distPath, {
        maxAge: "1d",
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            // The SPA shell must always be revalidated so users pick up new
            // chunk hashes, but we let the browser keep it cached pending
            // revalidation (faster back/forward navigation).
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Recall X247 Server running on http://localhost:${PORT}`);
  });
}

startServer();
