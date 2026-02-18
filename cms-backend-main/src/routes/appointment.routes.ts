import express from "express";
import {
  getAppointments,
  getAppointmentById,
  updateAppointment,
  deleteAppointment,
  createAppointment,
  getAppointmentsByDate,
  getAppointmentsForAdmin,
  getAppointmentsByPatient,
  assignCoordinator,
  updateCoordinator,
  mergeDuplicateAppointments,
  bulkMergeDuplicateAppointments,
  convertAppointmentToVisit,
  updateAppointmentSpeciality,
  checkFollowUpTasks,
  getHistoricalFollowUpCandidates,
  processHistoricalFollowUps,
} from "../controllers/appointment.controller";
const router = express.Router();

router.get("/", getAppointments);
router.get("/admin", getAppointmentsForAdmin);
router.get("/patient/:patientId", getAppointmentsByPatient);
router.get("/check-follow-up-tasks", checkFollowUpTasks);
router.get("/historical-follow-up-candidates", getHistoricalFollowUpCandidates);
router.get("/:id", getAppointmentById);
router.get("/date-range", getAppointmentsByDate);

router.post("/", createAppointment);
router.post("/assign-coordinator", assignCoordinator);
router.post("/merge-duplicates", mergeDuplicateAppointments);
router.post("/bulk-merge-duplicates", bulkMergeDuplicateAppointments);
router.post("/convert-to-visit", convertAppointmentToVisit);
router.post("/process-historical-follow-ups", processHistoricalFollowUps);

router.put("/", updateAppointment);
router.put("/:id/coordinator", updateCoordinator);
router.patch("/:id/speciality/:specialityId", updateAppointmentSpeciality);

router.delete("/:id", deleteAppointment);

export default router;
