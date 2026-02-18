import express from "express";
import {
  getVisitSpecialities,
  getVisitSpecialityById,
  updateVisitSpeciality,
  deleteVisitSpeciality,
  createVisitSpeciality,
} from "../controllers/visitSpeciality.controller";
const router = express.Router();

router.get("/", getVisitSpecialities);
router.get("/:id", getVisitSpecialityById);

router.post("/", createVisitSpeciality);

router.put("/", updateVisitSpeciality);

router.delete("/:id", deleteVisitSpeciality);

export default router;
