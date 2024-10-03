import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import sharp from "sharp";
import { LookoutVisionClient, StartModelCommand, DetectAnomaliesCommand, StopModelCommand } from "@aws-sdk/client-lookoutvision";

dotenv.config();

const app = express();
app.use(express.json());

const lookoutVisionConfig = {
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
};

const lookoutVisionClient = new LookoutVisionClient(lookoutVisionConfig);

app.post("/start-model", async (req, res) => {
  const { projectName, modelVersion, minInferenceUnits, maxInferenceUnits, clientToken } = req.body;

  const input = {
    ProjectName: projectName,
    ModelVersion: modelVersion,
    MinInferenceUnits: minInferenceUnits,
    ClientToken: clientToken || undefined,
    MaxInferenceUnits: maxInferenceUnits || undefined,
  };

  try {
    const command = new StartModelCommand(input);
    const response = await lookoutVisionClient.send(command);
    
    res.json(response);
  } catch (error) {
    console.error("Error starting LookoutVision model:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/stop-model", async (req, res) => {
    const { projectName, modelVersion } = req.body;
    
    const input = {
        ProjectName: projectName,
        ModelVersion: modelVersion,
    };
    
    try {
        const command = new StopModelCommand(input);
        const response = await lookoutVisionClient.send(command);
        
        res.json(response);
    } catch (error) {
        console.error("Error stopping LookoutVision model:", error);
        res.status(500).json({ error: error.message });
    }
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.post("/detect-anomalies", upload.single("image"), async (req, res) => {
  const { projectName, modelVersion, contentType } = req.body;
  
  if (!req.file) {
    return res.status(400).json({ error: "No image file uploaded." });
  }

  try {
    const resizedImageBuffer = await sharp(req.file.buffer)
    .resize(2268, 4032)
    .toBuffer();

    const input = {
        ProjectName: projectName,
        ModelVersion: modelVersion,
        Body: resizedImageBuffer,
        ContentType: contentType || req.file.mimetype,
    };

  const command = new DetectAnomaliesCommand(input);
    const response = await lookoutVisionClient.send(command);

    if (response.DetectAnomalyResult && response.DetectAnomalyResult.AnomalyMask) {
        delete response.DetectAnomalyResult.AnomalyMask;
      }

    res.json(response);
  } catch (error) {
    console.error("Error detecting anomalies:", error);
    res.status(500).json({ error: error.message });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
