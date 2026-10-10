
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const hazards = [];
let nextId = 1;

// Backend health check
app.get("/api/health", (req, res) => {
  res.json({
    message: "SafeRoute Navigator backend is running!"
  });
});

// Test route
app.get("/api/test", (req, res) => {
  res.json({
    message: "Correct backend file is running"
  });
});

// Get all hazard reports
app.get("/api/hazards", (req, res) => {
  res.json(hazards);
});

// Verify a hazard report
app.patch("/api/hazards/:id/verify", (req, res) => {
  const id = Number(req.params.id);
  const hazard = hazards.find(item => item.id === id);

  if (!hazard) {
    return res.status(404).json({
      error: "Hazard report not found"
    });
  }

  hazard.status = "verified";

  res.json({
    message: "Hazard verified successfully",
    hazard
  });
});

// Save a new hazard report
app.post("/api/hazards", (req, res) => {
  const { type, description, latitude, longitude } = req.body;

  if (
    typeof type !== "string" ||
    !type.trim() ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return res.status(400).json({
      error: "Please provide valid hazard details."
    });
  }

  const hazard = {
    id: nextId++,
    type: type.trim(),
    description:
      typeof description === "string" ? description : "",
    latitude,
    longitude,
    status: "unverified",
    createdAt: new Date().toISOString()
  };

  hazards.push(hazard);
  res.status(201).json(hazard);
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
