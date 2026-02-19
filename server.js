const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Tesseract = require("tesseract.js");
require("dotenv").config();

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* =====================================
   FILE UPLOAD CONFIG (Memory Storage)
===================================== */

const upload = multer({
  storage: multer.memoryStorage(), // IMPORTANT for OCR
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/* =====================================
   ROOT CHECK
===================================== */

app.get("/", (req, res) => {
  res.json({
    status: "Health Analyzer Backend Running",
    version: "USDA + OCR FREE EDITION",
  });
});

/* =====================================
   FOOD ANALYSIS USING USDA (FREE)
===================================== */

app.post("/analyze-food", async (req, res) => {
  try {
    const { foodName } = req.body;

    if (!foodName) {
      return res.status(400).json({ error: "Food name required" });
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
   PRESCRIPTION ANALYSIS (OCR FREE)
===================================== */

app.post("/analyze-prescription", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Prescription image required" });
    }

    // OCR using buffer
    const result = await Tesseract.recognize(
      req.file.buffer,
      "eng",
      { logger: (m) => console.log(m.status) }
    );

    const extractedText = result.data.text;

    // Advanced Medicine Detection
    const lines = extractedText.split("\n");
    const medicines = [];

    lines.forEach((line) => {
      const lower = line.toLowerCase();

      if (
        lower.includes("mg") ||
        lower.includes("tablet") ||
        lower.includes("tab") ||
        lower.includes("capsule") ||
        lower.includes("syrup")
      ) {
        medicines.push({
          name: line.trim(),
          dosage: "As prescribed",
          timing: "Follow doctor instructions",
          duration: "Check prescription",
        });
      }
    });

    res.json({
      rawText: extractedText,
      medicines:
        medicines.length > 0
          ? medicines
          : [{ name: "No clear medicines detected" }],
      doctor: "Doctor name may appear in header section",
    });
  } catch (error) {
    console.error("Prescription Error:", error);
    res.status(500).json({ error: "Prescription analysis failed" });
  }
});

/* =====================================
   START SERVER
===================================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
