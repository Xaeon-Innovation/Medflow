/**
 * AI Routes — All MedGemma-powered API endpoints
 */

import { Router } from 'express';
import * as aiChatCtrl from '../../controllers/ai-chat.controller';
import * as triageCtrl from '../../controllers/triage.controller';
import * as imagingCtrl from '../../controllers/imaging.controller';
import * as clinicalCtrl from '../../controllers/clinical.controller';
import * as timelineCtrl from '../../controllers/timeline.controller';

const router = Router();

// ═══════════════════════════════════════════
// AI CHAT
// ═══════════════════════════════════════════
router.post('/chat/sessions', aiChatCtrl.createSession);
router.get('/chat/sessions', aiChatCtrl.listSessions);
router.get('/chat/sessions/:sessionId', aiChatCtrl.getSession);
router.post('/chat/sessions/:sessionId/messages', aiChatCtrl.sendMessage);
router.delete('/chat/sessions/:sessionId', aiChatCtrl.endSession);
router.post('/chat/sessions/:sessionId/escalate', aiChatCtrl.escalateSession);

// ═══════════════════════════════════════════
// TRIAGE
// ═══════════════════════════════════════════
router.post('/triage/assess', triageCtrl.assessSymptoms);
router.get('/triage/:assessmentId', triageCtrl.getAssessment);
router.put('/triage/:assessmentId/outcome', triageCtrl.recordOutcome);

// ═══════════════════════════════════════════
// MEDICAL IMAGING
// ═══════════════════════════════════════════
router.post('/imaging/upload', imagingCtrl.uploadImage);
router.post('/imaging/:imageId/analyze', imagingCtrl.analyzeImage);
router.get('/imaging/:imageId/report', imagingCtrl.getReport);
router.put('/imaging/:analysisId/review', imagingCtrl.reviewAnalysis);
router.get('/imaging/patient/:patientId', imagingCtrl.getPatientImages);

// ═══════════════════════════════════════════
// CLINICAL DOCUMENTATION
// ═══════════════════════════════════════════
router.post('/docs/generate', clinicalCtrl.generateDocument);
router.get('/docs/:docId', clinicalCtrl.getDocument);
router.put('/docs/:docId/review', clinicalCtrl.reviewDocument);
router.get('/docs/patient/:patientId', clinicalCtrl.getPatientDocuments);

// ═══════════════════════════════════════════
// PATIENT HEALTH TIMELINE
// ═══════════════════════════════════════════
router.get('/timeline/patient/:patientId', timelineCtrl.getPatientTimeline);
router.post('/timeline/events', timelineCtrl.createEvent);
router.post('/timeline/events/:eventId/summary', timelineCtrl.generateEventSummary);

export default router;
