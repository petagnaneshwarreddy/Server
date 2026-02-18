const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Tesseract = require("tesseract.js");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

/* =====================================
   FILE UPLOAD CONFIG
===================================== */

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/* =====================================
   ROOT CHECK
===================================== */

app.get("/", (req, res) => {
  res.json({
    status: "Health Analyzer Backend Running",
    version: "USDA + OCR FREE EDITION"
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

    food.foodNutrients.forEach(n => {
      nutrients[n.nutrientName] = n.value;
    });

    res.json({
      food: food.description,
      calories: nutrients["Energy"] || 0,
      protein: nutrients["Protein"] || 0,
      carbs: nutrients["Carbohydrate, by difference"] || 0,
      fats: nutrients["Total lipid (fat)"] || 0,
      fiber: nutrients["Fiber, total dietary"] || 0
    });

  } catch (error) {
    console.error(error);
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

    const result = await Tesseract.recognize(
      req.file.buffer,
      "eng"
    );

    const extractedText = result.data.text;

    // Basic medicine detection logic
    const medicines = extractedText
      .split("\n")
      .filter(line =>
        line.toLowerCase().includes("mg") ||
        line.toLowerCase().includes("tab") ||
        line.toLowerCase().includes("tablet")
      );

    res.json({
      extractedText,
      medicines: medicines.length > 0 ? medicines : ["No clear medicines detected"]
    });

  } catch (error) {
    console.error(error);
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
