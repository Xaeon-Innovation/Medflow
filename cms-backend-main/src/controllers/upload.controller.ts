import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import "../middleware/auth.middleware"; // Import to extend Request interface

const UPLOAD_DIR = path.join(__dirname, "../../uploads/national-ids");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Helper function to get file extension from base64 data
const getExtensionFromBase64 = (base64String: string): string => {
  const mimeMatch = base64String.match(/data:image\/([^;]+);base64,/);
  if (mimeMatch) {
    const mimeType = mimeMatch[1].toLowerCase();
    if (mimeType === "jpeg" || mimeType === "jpg") return ".jpg";
    if (mimeType === "png") return ".png";
    if (mimeType === "webp") return ".webp";
  }
  return ".jpg"; // Default to jpg
};

// Helper function to validate image
const validateImage = (base64String: string): { valid: boolean; error?: string } => {
  if (!base64String || typeof base64String !== "string") {
    return { valid: false, error: "Invalid image data" };
  }

  // Check if it's a valid base64 image
  if (!base64String.startsWith("data:image/")) {
    return { valid: false, error: "Invalid image format. Must be base64 encoded image." };
  }

  // Extract base64 data
  const base64Data = base64String.split(",")[1];
  if (!base64Data) {
    return { valid: false, error: "Invalid base64 data" };
  }

  // Check file size (approximate - base64 is ~33% larger than binary)
  const sizeInBytes = (base64Data.length * 3) / 4;
  if (sizeInBytes > MAX_FILE_SIZE) {
    return { valid: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` };
  }

  // Check MIME type
  const mimeMatch = base64String.match(/data:image\/([^;]+);base64,/);
  if (mimeMatch) {
    const mimeType = `image/${mimeMatch[1].toLowerCase()}`;
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return { valid: false, error: "Invalid image type. Allowed: jpg, jpeg, png, webp" };
    }
  }

  return { valid: true };
};

export const uploadNationalIdImage = async (req: Request, res: Response) => {
  try {
    const { image, patientId } = req.body;

    if (!image) {
      return res.status(400).json({
        success: false,
        error: "Image data is required"
      });
    }

    // Validate image
    const validation = validateImage(image);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // Extract base64 data
    const base64Data = image.split(",")[1];
    const extension = getExtensionFromBase64(image);
    
    // Generate unique filename
    const timestamp = Date.now();
    const randomId = uuidv4().substring(0, 8);
    // Prevent path injection and overly long filenames
    const safePatientId = typeof patientId === 'string'
      ? patientId.trim().slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '')
      : '';

    const filename = safePatientId
      ? `${safePatientId}-${timestamp}-${randomId}${extension}`
      : `temp-${timestamp}-${randomId}${extension}`;
    
    const filePath = path.join(UPLOAD_DIR, filename);

    // Convert base64 to buffer and save
    const buffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(filePath, buffer);

    // Get file size
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    // Return relative URL path (will be served statically or via API)
    const fileUrl = `/uploads/national-ids/${filename}`;

    res.status(200).json({
      success: true,
      fileUrl,
      filename,
      fileSize
    });
  } catch (error) {
    console.error("Error uploading national ID image:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to upload image"
    });
  }
};

