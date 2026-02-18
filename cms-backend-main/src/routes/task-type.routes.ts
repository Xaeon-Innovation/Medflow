import express from "express";
import {
  getTaskTypes,
  getTaskTypeById,
  createTaskType,
  updateTaskType,
  deleteTaskType
} from "../controllers/taskType.controller";

const router = express.Router();

// GET /api/v1/task-types - Get all task types
router.get("/", getTaskTypes);

// GET /api/v1/task-types/:id - Get task type by ID
router.get("/:id", getTaskTypeById);

// POST /api/v1/task-types - Create new task type
router.post("/", createTaskType);

// PUT /api/v1/task-types/:id - Update task type
router.put("/:id", updateTaskType);

// DELETE /api/v1/task-types/:id - Delete task type
router.delete("/:id", deleteTaskType);

export default router;
