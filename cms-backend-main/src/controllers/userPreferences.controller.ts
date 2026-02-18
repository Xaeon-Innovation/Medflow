import { Request, Response } from "express";
import { prisma } from "../utils/database.utils";

// Get user preferences
export const getUserPreferences = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    let preferences = await prisma.userPreference.findUnique({
      where: { userId },
    });

    // Create default preferences if none exist
    if (!preferences) {
      preferences = await prisma.userPreference.create({
        data: {
          userId,
          pagePreferences: {},
        },
      });
    }

    res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    console.error("Get user preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve user preferences",
    });
  }
};

// Update user preferences
export const updateUserPreferences = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { pagePreferences } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const updatedPreferences = await prisma.userPreference.upsert({
      where: { userId },
      update: {
        pagePreferences: pagePreferences || {},
      },
      create: {
        userId,
        pagePreferences: pagePreferences || {},
      },
    });

    res.status(200).json({
      success: true,
      data: updatedPreferences,
      message: "User preferences updated successfully",
    });
  } catch (error) {
    console.error("Update user preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user preferences",
    });
  }
};
