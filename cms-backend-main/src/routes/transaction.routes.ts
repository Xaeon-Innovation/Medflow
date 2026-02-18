import express from "express";
import {
  getTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  createTransaction,
  getTransactionsByDate,
  getPatientsForTransactionEntry,
  getTransactionSummary,
  getAllHospitalsSummary,
  bulkCreateTransactions,
  parseTransactionExcel,
  getTransactionsBySalesPersonId,
} from "../controllers/transaction.controller";
import { authenticateToken } from "../middleware/auth.middleware";

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Transaction routes
router.get("/", getTransactions);
router.get("/summary", getTransactionSummary);
router.get("/summary/all-hospitals", getAllHospitalsSummary);
router.get("/patients", getPatientsForTransactionEntry);
router.get("/date-range", getTransactionsByDate);
router.get("/by-sales/:salesPersonId", getTransactionsBySalesPersonId);
router.get("/:id", getTransactionById);

router.post("/", createTransaction);
router.post("/bulk", bulkCreateTransactions);
router.post("/parse-excel", parseTransactionExcel);

router.put("/:id", updateTransaction);

router.delete("/:id", deleteTransaction);

export default router;