const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Tesseract = require("tesseract.js");
require("dotenv").config();

const app = express();

/* =====================================
   BASIC SERVER SETTINGS
===================================== */

// Increase server timeout (important for OCR)
const server = require("http").createServer(app);
server.timeout = 120000; // 2 minutes

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

app.use(express.json());

/* =====================================
   HEALTH CHECK (IMPORTANT FOR RENDER)
===================================== */

app.get("/", (req, res) => {
  res.status(200).json({
    status: "NutriScan AI Backend Running",
    uptime: process.uptime(),
  });
});

// Better health endpoint for cron-job
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* =====================================
   FILE UPLOAD CONFIG
===================================== */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/* =====================================
   FOOD ANALYSIS
===================================== */

app.post("/analyze-food", async (req, res) => {
  try {
    const { foodName } = req.body;

    if (!foodName) {
      return res.status(400).json({ error: "Food name required" });
    }

    if (!process.env.USDA_API_KEY) {
      return res.status(500).json({ error: "USDA API key missing" });
    }

    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${foodName}&api_key=${process.env.USDA_API_KEY}`
    );

    const data = await response.json();

    if (!data.foods || data.foods.length === 0) {
      return res.status(404).json({ error: "Food not found" });
    }

    const food = data.foods[0];
    const nutrients = {};

    food.foodNutrients.forEach((n) => {
      nutrients[n.nutrientName] = n.value;
    });

    res.json({
      food: food.description,
      calories: nutrients["Energy"] || 0,
      protein: nutrients["Protein"] || 0,
      carbs: nutrients["Carbohydrate, by difference"] || 0,
      fats: nutrients["Total lipid (fat)"] || 0,
      fiber: nutrients["Fiber, total dietary"] || 0,
    });
  } catch (error) {
    console.error("Food Error:", error);
    res.status(500).json({ error: "Food analysis failed" });
  }
});

/* =====================================
   PRESCRIPTION ANALYSIS (OPTIMIZED)
===================================== */

app.post("/analyze-prescription", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Prescription image required" });
    }

    console.log("📷 File received:", req.file.originalname);

    // Run OCR
    const result = await Tesseract.recognize(
      req.file.buffer,
      "eng",
      { logger: () => {} } // remove heavy logging
    );

    const extractedText = result?.data?.text;

    if (!extractedText) {
      return res.status(400).json({ error: "No text detected" });
    }

    const medicines = detectMedicines(extractedText);

    res.json({
      rawText: extractedText,
      medicines:
        medicines.length > 0
          ? medicines
          : [{ name: "No clear medicines detected" }],
      doctor: extractDoctorName(extractedText),
    });

  } catch (error) {
    console.error("Prescription Error:", error);

    res.status(500).json({
      error: "Prescription analysis failed. Server may be waking up.",
    });
  }
});

/* =====================================
   MEDICINE DETECTION
===================================== */

function detectMedicines(text) {
  const lines = text.split("\n");
  const medicines = [];

  lines.forEach((line) => {
    const clean = line.trim();
    const lower = clean.toLowerCase();

    const isMedicine =
      /\d/.test(clean) &&
      (
        lower.includes("mg") ||
        lower.includes("ml") ||
        lower.includes("tab") ||
        lower.includes("cap") ||
        lower.includes("bd") ||
        lower.includes("td") ||
        lower.includes("qd") ||
        lower.includes("od")
      );

    if (isMedicine) {
      medicines.push({
        name: extractMedicineName(clean),
        dosage: extractDosage(clean),
        timing: extractTiming(clean),
        duration: "As prescribed",
      });
    }
  });

  return medicines;
}

/* =====================================
   HELPERS
===================================== */

function extractDosage(text) {
  const match = text.match(/(\d+\s?(mg|ml))/i);
  return match ? match[0] : "Not specified";
}

function extractTiming(text) {
  const lower = text.toLowerCase();

  if (lower.includes("bd")) return "Twice Daily";
  if (lower.includes("td")) return "Three Times Daily";
  if (lower.includes("qd") || lower.includes("od")) return "Once Daily";

  return "Follow doctor instructions";
}

function extractMedicineName(text) {
  return text.replace(/(\d+\s?(mg|ml).*)/i, "").trim();
}

function extractDoctorName(text) {
  const lines = text.split("\n");
  for (let line of lines) {
    if (line.toLowerCase().includes("dr")) {
      return line.trim();
    }
  }
  return "Doctor name not detected";
}

/* =====================================
   START SERVER
===================================== */

const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 NutriScan AI Backend running on port ${PORT}`);
});