import express from "express";
import dotenv from "dotenv";
import { LookoutVisionClient, StartModelCommand, DetectAnomaliesCommand, StopModelCommand } from "@aws-sdk/client-lookoutvision";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
const s3Client = new S3Client(lookoutVisionConfig);

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
      // Resize the original uploaded image
      const originalImageBuffer = await sharp(req.file.buffer)
        .resize(2268, 4032)
        .toBuffer();
  
      const input = {
        ProjectName: projectName,
        ModelVersion: modelVersion,
        Body: originalImageBuffer,
        ContentType: contentType || req.file.mimetype,
      };
  
      const command = new DetectAnomaliesCommand(input);
      const response = await lookoutVisionClient.send(command);
  
      if (response.DetectAnomalyResult && response.DetectAnomalyResult.AnomalyMask) {
        const anomalyMaskBuffer = Buffer.from(Object.values(response.DetectAnomalyResult.AnomalyMask));
  
        const resizedAnomalyMask = await sharp(anomalyMaskBuffer)
          .resize(2268, 4032)
          .toBuffer();
  
        const compositeImageBuffer = await sharp(originalImageBuffer)
          .composite([{ input: resizedAnomalyMask, blend: 'overlay' }])
          .toBuffer();
  
        const fileExtension = req.file.mimetype.split('/')[1];
        const fileName = `anomaly_overlay_${Date.now()}.${fileExtension}`;
        const s3Params = {
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: `output_detect/${fileName}`,
          Body: compositeImageBuffer,
          ContentType: req.file.mimetype,
        };
  
        const uploadCommand = new PutObjectCommand(s3Params);
        await s3Client.send(uploadCommand);
  
        const s3Url = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/output_detect/${fileName}`;
        response.DetectAnomalyResult.AnomalyOverlayUrl = s3Url;
      }
  
      delete response.DetectAnomalyResult.AnomalyMask;
  
      res.json(response);
    } catch (error) {
      console.error("Error detecting anomalies or uploading to S3:", error);
      res.status(500).json({ error: error.message });
    }
  });


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
