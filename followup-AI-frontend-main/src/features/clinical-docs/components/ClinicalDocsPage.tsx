"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    FileText,
    Sparkles,
    Loader2,
    CheckCircle2,
    Copy,
    Download,
    Edit,
    FileCheck,
    ClipboardList,
    Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { generateDocument, getDocument } from "@/lib/ai-api";
import type { ClinicalDocType, ClinicalDocResponse } from "@/types/ai";
import { cn } from "@/lib/utils";

const DOC_TYPES: { value: ClinicalDocType; label: string; icon: typeof FileText; desc: string }[] = [
    { value: "SOAP_NOTE", label: "SOAP Note", icon: FileText, desc: "Structured clinical note" },
    { value: "DISCHARGE_SUMMARY", label: "Discharge Summary", icon: FileCheck, desc: "Visit summary & instructions" },
    { value: "PROGRESS_NOTE", label: "Progress Note", icon: ClipboardList, desc: "Follow-up documentation" },
    { value: "REFERRAL_LETTER", label: "Referral Letter", icon: Stethoscope, desc: "Specialist referral" },
    { value: "PATIENT_INSTRUCTIONS", label: "Patient Instructions", icon: FileText, desc: "Care instructions" },
    { value: "PRIOR_AUTH", label: "Prior Authorization", icon: FileCheck, desc: "Insurance authorization" },
];

export function ClinicalDocsPage() {
    const [docType, setDocType] = useState<ClinicalDocType>("SOAP_NOTE");
    const [patientId, setPatientId] = useState("");
    const [appointmentId, setAppointmentId] = useState("");
    const [visitNotes, setVisitNotes] = useState("");
    const [conversationTranscript, setConversationTranscript] = useState("");
    const [diagnosis, setDiagnosis] = useState("");
    const [treatmentPlan, setTreatmentPlan] = useState("");
    const [medications, setMedications] = useState("");
    const [additionalContext, setAdditionalContext] = useState("");
    const [generating, setGenerating] = useState(false);
    const [document, setDocument] = useState<ClinicalDocResponse | null>(null);

    const handleGenerate = async () => {
        if (!patientId) {
            alert("Please enter a patient ID");
            return;
        }

        setGenerating(true);
        try {
            const result = await generateDocument({
                clinicId: "default-clinic",
                patientId,
                appointmentId: appointmentId || undefined,
                docType,
                inputData: {
                    visitNotes: visitNotes || undefined,
                    conversationTranscript: conversationTranscript || undefined,
                    diagnosis: diagnosis || undefined,
                    treatmentPlan: treatmentPlan || undefined,
                    medications: medications.split(",").map((m) => m.trim()).filter(Boolean),
                    additionalContext: additionalContext || undefined,
                },
            });
            setDocument(result);
        } catch (error: any) {
            console.error("Generation failed:", error);
            alert(`Failed to generate document: ${error.message}`);
        } finally {
            setGenerating(false);
        }
    };

    const handleCopy = () => {
        if (document) {
            navigator.clipboard.writeText(document.content);
            alert("Copied to clipboard!");
        }
    };

    const reset = () => {
        setDocument(null);
        setVisitNotes("");
        setConversationTranscript("");
        setDiagnosis("");
        setTreatmentPlan("");
        setMedications("");
        setAdditionalContext("");
    };

    const activeDocType = DOC_TYPES.find((d) => d.value === docType);

    return (
        <div className="flex h-full flex-col bg-slate-950 overflow-hidden">
            {/* Header */}
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 bg-slate-900/50 px-6 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                        <FileText className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-slate-100">AutoScribe — Clinical Documentation</h2>
                        <p className="text-xs text-slate-500">AI-powered note generation with MedGemma 27B</p>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden grid grid-cols-2 gap-6 p-6">
                {/* Left: Input Form */}
                <div className="flex flex-col gap-4 overflow-y-auto">
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-white">Document Generation</h3>

                        {/* Document Type */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Document Type</label>
                            <Select
                                value={docType}
                                onChange={(e) => setDocType(e.target.value as ClinicalDocType)}
                                className="bg-slate-800 border-white/10 text-slate-100"
                                options={DOC_TYPES.map((dt) => ({ value: dt.value, label: dt.label }))}
                            />
                            {activeDocType && (
                                <p className="text-xs text-slate-500 mt-1">{activeDocType.desc}</p>
                            )}
                        </div>

                        {/* Patient & Appointment IDs */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Patient ID <span className="text-red-400">*</span>
                                </label>
                                <Input
                                    value={patientId}
                                    onChange={(e) => setPatientId(e.target.value)}
                                    placeholder="Required"
                                    className="bg-slate-800 border-white/10 text-slate-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Appointment ID</label>
                                <Input
                                    value={appointmentId}
                                    onChange={(e) => setAppointmentId(e.target.value)}
                                    placeholder="Optional"
                                    className="bg-slate-800 border-white/10 text-slate-100"
                                />
                            </div>
                        </div>

                        {/* Visit Notes */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Visit Notes</label>
                            <textarea
                                value={visitNotes}
                                onChange={(e) => setVisitNotes(e.target.value)}
                                placeholder="Enter visit notes, observations, or clinical findings..."
                                rows={6}
                                className="w-full rounded-xl bg-slate-800 border border-white/10 p-3 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none font-mono text-sm"
                            />
                        </div>

                        {/* Conversation Transcript */}
                        {(docType === "SOAP_NOTE" || docType === "PROGRESS_NOTE") && (
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Conversation Transcript
                                </label>
                                <textarea
                                    value={conversationTranscript}
                                    onChange={(e) => setConversationTranscript(e.target.value)}
                                    placeholder="Optional: Patient-provider conversation transcript..."
                                    rows={4}
                                    className="w-full rounded-xl bg-slate-800 border border-white/10 p-3 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none font-mono text-sm"
                                />
                            </div>
                        )}

                        {/* Diagnosis & Treatment */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Diagnosis</label>
                                <Input
                                    value={diagnosis}
                                    onChange={(e) => setDiagnosis(e.target.value)}
                                    placeholder="e.g. Acute bronchitis"
                                    className="bg-slate-800 border-white/10 text-slate-100"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Treatment Plan</label>
                                <Input
                                    value={treatmentPlan}
                                    onChange={(e) => setTreatmentPlan(e.target.value)}
                                    placeholder="Brief treatment summary"
                                    className="bg-slate-800 border-white/10 text-slate-100"
                                />
                            </div>
                        </div>

                        {/* Medications */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Medications</label>
                            <Input
                                value={medications}
                                onChange={(e) => setMedications(e.target.value)}
                                placeholder="Comma-separated: Metformin 500mg BID, Lisinopril 10mg daily"
                                className="bg-slate-800 border-white/10 text-slate-100"
                            />
                        </div>

                        {/* Additional Context */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Additional Context</label>
                            <textarea
                                value={additionalContext}
                                onChange={(e) => setAdditionalContext(e.target.value)}
                                placeholder="Any other relevant information..."
                                rows={3}
                                className="w-full rounded-xl bg-slate-800 border border-white/10 p-3 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 resize-none"
                            />
                        </div>

                        {/* Generate Button */}
                        <Button
                            onClick={handleGenerate}
                            disabled={generating || !patientId}
                            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white"
                        >
                            {generating ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="mr-2 h-4 w-4" />
                                    Generate Document
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Right: Generated Document */}
                <div className="flex flex-col gap-4 overflow-y-auto">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-white">Generated Document</h3>
                        {document && (
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCopy}
                                    className="border-white/10 hover:bg-white/5 text-slate-300"
                                >
                                    <Copy className="mr-2 h-3 w-3" />
                                    Copy
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={reset}
                                    className="border-white/10 hover:bg-white/5 text-slate-300"
                                >
                                    New
                                </Button>
                            </div>
                        )}
                    </div>

                    {generating && (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-60">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                            >
                                <Sparkles className="h-16 w-16 text-emerald-400" />
                            </motion.div>
                            <p className="text-lg font-medium text-emerald-400">Generating document...</p>
                            <p className="text-sm text-slate-500">MedGemma 27B processing your input</p>
                        </div>
                    )}

                    {document && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-4"
                        >
                            {/* Document Header */}
                            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-900/10 p-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h4 className="text-xl font-bold text-white mb-1">{document.title}</h4>
                                        <p className="text-xs text-emerald-400 uppercase tracking-wider">
                                            {document.docType.replace("_", " ")}
                                        </p>
                                    </div>
                                    <div className="px-3 py-1 rounded-lg bg-slate-800 border border-white/10">
                                        <span className="text-xs font-medium text-slate-300">{document.status}</span>
                                    </div>
                                </div>
                                {document.suggestedIcd10.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-white/5">
                                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                            Suggested ICD-10 Codes
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {document.suggestedIcd10.map((code, i) => (
                                                <span
                                                    key={i}
                                                    className="px-2 py-1 rounded bg-slate-800 border border-white/10 text-xs font-mono text-emerald-400"
                                                >
                                                    {code}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Document Content */}
                            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6">
                                <div className="prose prose-invert max-w-none">
                                    <pre className="whitespace-pre-wrap text-sm text-slate-200 font-mono leading-relaxed">
                                        {document.content}
                                    </pre>
                                </div>
                            </div>

                            {/* Metadata */}
                            <div className="flex items-center justify-between text-xs text-slate-500 pt-4 border-t border-white/5">
                                <span>Model: {document.modelUsed}</span>
                                <span>{new Date(document.createdAt).toLocaleString()}</span>
                            </div>
                        </motion.div>
                    )}

                    {!document && !generating && (
                        <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                            <FileText className="h-24 w-24 text-slate-700 mb-6" />
                            <h3 className="text-xl font-bold text-slate-300">No Document Generated</h3>
                            <p className="text-slate-500 max-w-sm mt-2">
                                Fill in the form and click "Generate Document" to create AI-powered clinical documentation.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
