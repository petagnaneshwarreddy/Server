const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Tesseract = require("tesseract.js");
require("dotenv").config();

const app = express();

/* =====================================
   CORS CONFIG
===================================== */

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

app.use(express.json());

/* =====================================
   FILE UPLOAD (Memory Storage)
===================================== */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

/* =====================================
   ROOT CHECK
===================================== */

app.get("/", (req, res) => {
  res.json({
    status: "Health Analyzer Backend Running",
    version: "OCR + USDA STABLE BUILD",
  });
});

/* =====================================
   FOOD ANALYSIS (USDA FREE)
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

    if (!response.ok) {
      throw new Error("USDA API error");
    }

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
    console.error("❌ Food Error:", error.message);
    res.status(500).json({ error: "Food analysis failed" });
  }
});

/* =====================================
   PRESCRIPTION ANALYSIS (OCR)
===================================== */

app.post("/analyze-prescription", upload.single("file"), async (req, res) => {
  let worker;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Prescription image required" });
    }

    console.log("📷 File received:", req.file.originalname);

    // Create worker (safer than direct recognize)
    worker = await Tesseract.createWorker("eng");

    const { data } = await worker.recognize(req.file.buffer);

    const extractedText = data.text;

    if (!extractedText || extractedText.trim() === "") {
      return res.status(400).json({
        error: "Could not read prescription text clearly",
      });
    }

    const medicines = extractMedicines(extractedText);

    res.json({
      rawText: extractedText,
      medicines:
        medicines.length > 0
          ? medicines
          : [{ name: "No clear medicines detected" }],
      doctor: extractDoctorName(extractedText),
    });
  } catch (error) {
    console.error("❌ OCR Error:", error.message);
    res.status(500).json({
      error: "OCR failed (memory limit or unclear image)",
    });
  } finally {
    if (worker) {
      await worker.terminate();
    }
  }
});

/* =====================================
   HELPER FUNCTIONS
===================================== */

function extractMedicines(text) {
  const lines = text.split("\n");
  const medicines = [];

  lines.forEach((line) => {
    const lower = line.toLowerCase();

    if (
      lower.includes("mg") ||
      lower.includes("tablet") ||
      lower.includes("tab") ||
      lower.includes("capsule") ||
      lower.includes("syrup") ||
      lower.includes("ml")
    ) {
      medicines.push({
        name: line.trim(),
        dosage: extractDosage(line),
        timing: detectTiming(line),
        duration: detectDuration(line),
      });
    }
  });

  return medicines;
}

function extractDosage(text) {
  const match = text.match(/(\d+ ?mg|\d+ ?ml)/i);
  return match ? match[0] : "Not specified";
}

function detectTiming(text) {
  const lower = text.toLowerCase();

  if (lower.includes("bd") || lower.includes("twice"))
    return "Twice Daily";
  if (lower.includes("tds") || lower.includes("thrice"))
    return "Three Times Daily";
  if (lower.includes("od") || lower.includes("once"))
    return "Once Daily";

  return "Follow doctor instructions";
}

function detectDuration(text) {
  const match = text.match(/(\d+ ?days|\d+ ?weeks)/i);
  return match ? match[0] : "As prescribed";
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
