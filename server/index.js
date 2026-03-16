/*
Author: Vien Trieu (Date: 6-27-2025)
Description: Express server setup with Supabase integration, providing health-check, CRUD endpoints for parts, and error handling.
*/

/* === Module Imports ===================================================== */
const path = require("path");
const express = require("express");
const cors = require("cors");
const supabase = require("./db");

const multer = require("multer");

/* === Environment Configuration ========================================= */
console.log("ENV CHECK:", {
  hasUrl: !!process.env.SUPABASE_URL,
  hasAnon: !!process.env.SUPABASE_ANON_KEY,
  urlPreview: (process.env.SUPABASE_URL || "").slice(0, 28),
  anonPreview: (process.env.SUPABASE_ANON_KEY || "").slice(0, 12),
});

// Optional: uncomment if you get TLS certificate errors during development
// process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

/* === App Initialization ================================================= */
const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  if (req.path === "/upload-image") {
    console.log("➡️ HIT /upload-image", {
      method: req.method,
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
    });
  }
  next();
});

// ⭐ ADD: Multer upload middleware (in-memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

/* === Server Port ======================================================== */
const PORT = process.env.PORT || 3002;

// === Helper: derive storage path from public URL & delete from bucket =======
function extractStoragePathFromPublicUrl(imageUrl) {
  try {
    const u = new URL(imageUrl);
    // Example pathname:
    // /storage/v1/object/public/part-images/parts/123-file.png
    const marker = "/storage/v1/object/public/part-images/";
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) {
      console.warn("⚠️ Could not find expected marker in image URL:", imageUrl);
      return null;
    }
    const storagePath = u.pathname.slice(idx + marker.length); // e.g. "parts/123-file.png"
    return storagePath;
  } catch (e) {
    console.warn("⚠️ Failed to parse image URL:", imageUrl, e);
    return null;
  }
}

async function deleteImageFromStorage(imageUrl) {
  if (!imageUrl) return;

  const storagePath = extractStoragePathFromPublicUrl(imageUrl);
  if (!storagePath) {
    console.warn(
      "⚠️ No storage path derived from URL, skipping delete:",
      imageUrl,
    );
    return;
  }

  console.log("🧹 Deleting image from storage:", storagePath);
  const { error } = await supabase.storage
    .from("part-images")
    .remove([storagePath]);

  if (error) {
    console.error("⚠️ Failed to delete image from storage:", error);
  } else {
    console.log("✅ Image deleted from storage:", storagePath);
  }
}

/* === Routes: Health Check =============================================== */
// Health check endpoint to verify Supabase connectivity
app.get("/test-supabase", async (req, res) => {
  try {
    const { data, error } = await supabase.from("parts").select("*").limit(1);
    if (error) {
      console.error("❌ Supabase fetch error:", error);
      return res
        .status(500)
        .json({ error: "Supabase unreachable", details: error });
    }
    res.json({ message: "✅ Supabase connected!", data });
  } catch (err) {
    console.error("🔥 Unexpected error in /test-supabase:", err);
    res
      .status(500)
      .json({ error: "Unexpected server error", details: err.message });
  }
});

/* === Routes: Parts CRUD with Pagination ================================= */
// Search parts by name or number, with pagination (supports partial matches)
app.get("/parts", async (req, res) => {
  try {
    const { name, number } = req.query;
    let { page = "1", limit = "5" } = req.query;

    if (!name && !number) {
      return res
        .status(400)
        .json({ error: "Please provide a name or number query parameter" });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 5);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    // Start query with total count for pagination
    let q = supabase.from("parts").select("*", { count: "exact" });

    if (name) {
      // Partial match on name (contains)
      q = q.ilike("name", `%${name}%`);
    } else if (number) {
      // ✅ Partial match on part_number
      // Use `%${number}%` for contains OR `${number}%` for prefix-only
      q = q.ilike("part_number", `%${number}%`);
    }

    // You had id-desc; keep it, or switch to part_number ascending if you prefer
    q = q.order("id", { ascending: false }).range(from, to);

    const { data, error, count } = await q;
    if (error) {
      console.error("❌ Error fetching parts from Supabase:", error);
      return res
        .status(500)
        .json({ error: "Internal server error", details: error });
    }

    const totalPages = Math.max(1, Math.ceil((count || 0) / limitNum));
    return res.json({ results: data || [], totalPages });
  } catch (e) {
    console.error("🔥 Unexpected error:", e);
    return res
      .status(500)
      .json({ error: "Unexpected server error", details: e.message });
  }
});

// Add a new part
app.post("/parts", async (req, res) => {
  const { name, part_number, location, image_url } = req.body;
  console.log("🚀 POST /parts received", req.body);
  if (!name || !part_number || !location) {
    console.log("❌ Missing required fields");
    return res.status(400).json({ error: "All fields are required" });
  }

  //Build insert object safely: only send image_url if provided
  const insertObj = { name, part_number, location };

  if (image_url) {
    insertObj.image_url = image_url;
  }

  console.log("➡️ Inserting part:", insertObj);

  try {
    const { data, error } = await supabase
      .from("parts")
      .insert([{ name, part_number, location, image_url }])
      .select();
    if (error) {
      console.error("❌ Supabase insert error:", error);
      return res
        .status(500)
        .json({ error: "Internal server error", details: error });
    }
    res.status(201).json(data[0]);
  } catch (err) {
    console.error("🔥 Unexpected error:", err);
    res
      .status(500)
      .json({ error: "Unexpected server error", details: err.message });
  }
});

// Update an existing part
app.put("/parts/:id", async (req, res) => {
  const { id } = req.params;
  const { name, part_number, location, image_url } = req.body;
  console.log("➡️ Updating ID:", id, "with", req.body);
  if (!name || !part_number || !location) {
    return res.status(400).json({ error: "All fields are required" });
  }
  const { data, error } = await supabase
    .from("parts")
    .update({ name, part_number, location, image_url }) // ⭐ CHANGED
    .eq("id", id)
    .select();
  if (error) {
    console.error("❌ Error updating part:", error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json(data[0]);
});

// Delete a part (and its image if present)
app.delete("/parts/:id", async (req, res) => {
  const { id } = req.params;
  console.log("➡️ Deleting ID:", id);

  const { data, error } = await supabase
    .from("parts")
    .delete()
    .eq("id", id)
    .select();

  if (error) {
    console.error("❌ Error deleting part:", error);
    return res.status(500).json({ error: "Server error" });
  }
  if (!data || data.length === 0) {
    return res.status(404).json({ error: "Part not found" });
  }

  const deleted = data[0];

  // 🧹 Try to delete image from storage, but don't fail the request if this fails
  if (deleted && deleted.image_url) {
    deleteImageFromStorage(deleted.image_url).catch((e) => {
      console.error("⚠️ Failed to delete image from storage (non-fatal):", e);
    });
  }

  return res.sendStatus(204);
});

// --- ADD: Type-ahead suggestions for part numbers ---
// GET /parts/suggest?numberPrefix=AB1&limit=8
app.get("/parts/suggest", async (req, res) => {
  try {
    const { numberPrefix = "", limit = 8 } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 8, 25); // hard cap

    if (!numberPrefix) return res.json([]);

    // Supabase prefix match with ilike 'prefix%'
    const { data, error } = await supabase
      .from("parts")
      .select("id, name, part_number, location")
      .ilike("part_number", `${numberPrefix}%`)
      .order("part_number", { ascending: true })
      .limit(lim);

    if (error) {
      console.error("Suggest error:", error);
      return res.status(500).json({ error: "Failed to fetch suggestions" });
    }

    return res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ⭐ ADD/REPLACE: Image upload endpoint
// POST /upload-image  (multipart/form-data, field name: "file")
app.post("/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const file = req.file;
    console.log(
      "/upload-image received file:",
      file.originalname,
      file.mimetype,
      file.size,
    );

    const ext = path.extname(file.originalname) || "";
    const fileName = `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}${ext}`;
    const storagePath = `parts/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("part-images")
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error("❌ Supabase Storage upload error:", {
        message: uploadError.message,
        status: uploadError.status,
        name: uploadError.name,
        cause: uploadError.cause,
        full: uploadError,
      });
      return res.status(500).json({
        error: "Failed to upload image",
        details: uploadError.message,
        status: uploadError.status,
      });
    }

    const { data: publicData } = supabase.storage
      .from("part-images")
      .getPublicUrl(storagePath);

    const image_url = publicData.publicUrl;
    console.log("✅ Uploaded image, URL:", image_url);

    return res.json({ image_url });
  } catch (err) {
    console.error("🔥 Unexpected error in /upload-image:", err);
    return res.status(500).json({
      error: "Unexpected server error",
      details: err.message,
    });
  }
});

/* === Routes: Miscellaneous ============================================= */
// Hello test endpoint
app.get("/api/hello", (req, res) => {
  res.send({ message: "Backend is working!" });
});

// Debug connection endpoint
app.get("/debug-connection", async (req, res) => {
  try {
    const { data, error } = await supabase.from("parts").select("*").limit(1);
    if (error) throw error;
    res.json({ message: "✅ Supabase connected", data });
  } catch (err) {
    console.error("🚨 Supabase debug error:", err);
    res
      .status(500)
      .json({ error: "Supabase fetch failed", details: err.message });
  }
});

/* === Server Startup (loopback-only binding) ==================================================== */
const HOST = "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT} (loopback only)`);
});

/* === Global Error Handlers ============================================= */
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection:", reason);
});
