"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Check,
    Clock,
    Heart,
    Stethoscope,
    Thermometer,
    User,
    Wind,
    ShieldAlert,
    ListRestart
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { submitTriage } from "@/lib/ai-api";
import type { TriageRequest, TriageSymptom, TriageResponse } from "@/types/ai";
import { cn } from "@/lib/utils";

const ESI_COLORS: Record<number, { bg: string; text: string; border: string; label: string }> = {
    1: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/50", label: "Immediate — Resuscitation" },
    2: { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/50", label: "Emergent — High Risk" },
    3: { bg: "bg-yellow-500/20", text: "text-yellow-400", border: "border-yellow-500/50", label: "Urgent — Multiple Resources" },
    4: { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/50", label: "Less Urgent — One Resource" },
    5: { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/50", label: "Non-Urgent — No Resources" },
};

export function TriageForm() {
    const [step, setStep] = useState(1);
    const [chiefComplaint, setChiefComplaint] = useState("");
    const [symptoms, setSymptoms] = useState<TriageSymptom[]>([{ symptom: "", severity: 3, onset: "" }]);
    const [vitals, setVitals] = useState({
        heartRate: "",
        systolic: "",
        diastolic: "",
        temperature: "",
        respiratoryRate: "",
        oxygenSaturation: "",
    });
    const [patientAge, setPatientAge] = useState("");
    const [patientSex, setPatientSex] = useState("M");
    const [medicalHistory, setMedicalHistory] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<TriageResponse | null>(null);

    const nextStep = () => setStep(s => Math.min(s + 1, 3));
    const prevStep = () => setStep(s => Math.max(s - 1, 1));

    const handleSubmit = async () => {
        if (!chiefComplaint.trim()) return;
        setLoading(true);
        setResult(null);

        const req: TriageRequest = {
            clinicId: "default-clinic",
            chiefComplaint,
            symptoms: symptoms.filter((s) => s.symptom.trim()),
            patientAge: patientAge ? parseInt(patientAge) : undefined,
            patientSex: patientSex || undefined,
            medicalHistory: medicalHistory.split(",").map((s) => s.trim()).filter(Boolean),
        };

        const hasVitals = Object.values(vitals).some((v) => v);
        if (hasVitals) {
            req.vitalSigns = {
                heartRate: vitals.heartRate ? parseInt(vitals.heartRate) : undefined,
                bloodPressure: vitals.systolic && vitals.diastolic
                    ? { systolic: parseInt(vitals.systolic), diastolic: parseInt(vitals.diastolic) }
                    : undefined,
                temperature: vitals.temperature ? parseFloat(vitals.temperature) : undefined,
                respiratoryRate: vitals.respiratoryRate ? parseInt(vitals.respiratoryRate) : undefined,
                oxygenSaturation: vitals.oxygenSaturation ? parseInt(vitals.oxygenSaturation) : undefined,
            };
        }

        try {
            const res = await submitTriage(req);
            setResult(res);
        } catch (err) {
            console.error("Triage failed:", err);
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setResult(null);
        setStep(1);
        setChiefComplaint("");
        setSymptoms([{ symptom: "", severity: 3, onset: "" }]);
        setVitals({ heartRate: "", systolic: "", diastolic: "", temperature: "", respiratoryRate: "", oxygenSaturation: "" });
    };

    return (
        <div className="flex h-full flex-col md:flex-row bg-slate-950 overflow-hidden">
            {/* ─── LEFT: Form Stepper ──────────────────────── */}
            <div className="flex-1 flex flex-col border-r border-white/5 bg-slate-900/50 backdrop-blur-xl z-10">
                {/* Steps Header */}
                <div className="flex justify-between items-center p-6 border-b border-white/10">
                    <div className="flex gap-2">
                        {[1, 2, 3].map(i => (
                            <div key={i} className={cn(
                                "h-1 w-8 rounded-full transition-all duration-300",
                                step >= i ? "bg-teal-500" : "bg-slate-700"
                            )} />
                        ))}
                    </div>
                    <span className="text-xs font-mono text-slate-500">STEP {step}/3</span>
                </div>

                {/* Form Content */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8">
                    <AnimatePresence mode="wait">
                        {step === 1 && (
                            <motion.div
                                key="step1"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="space-y-6"
                            >
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Patient Intake</h2>
                                    <p className="text-slate-400">Basic demographics and primary concern.</p>
                                </div>

                                <div className="space-y-4">
                                    <label className="block text-sm font-medium text-slate-300">Chief Complaint <span className="text-red-400">*</span></label>
                                    <textarea
                                        value={chiefComplaint}
                                        onChange={(e) => setChiefComplaint(e.target.value)}
                                        className="w-full h-32 rounded-xl bg-slate-800 border border-white/10 p-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/50 resize-none"
                                        placeholder="Describe the main reason for visit..."
                                        autoFocus
                                    />

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Age</label>
                                            <Input
                                                value={patientAge}
                                                onChange={(e) => setPatientAge(e.target.value)}
                                                className="bg-slate-800 border-white/10 text-slate-100"
                                                placeholder="e.g. 45"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Sex</label>
                                            <div className="flex gap-2">
                                                {["M", "F"].map(s => (
                                                    <button key={s} onClick={() => setPatientSex(s)} className={cn(
                                                        "flex-1 py-2 rounded-lg border text-sm font-medium transition-all",
                                                        patientSex === s
                                                            ? "bg-teal-500/20 border-teal-500/50 text-teal-400"
                                                            : "bg-slate-800 border-white/5 text-slate-400 hover:bg-slate-700"
                                                    )}>{s}</button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {step === 2 && (
                            <motion.div
                                key="step2"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="space-y-6"
                            >
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Vitals & Assessment</h2>
                                    <p className="text-slate-400">Current physiological parameters.</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 font-semibold"><Heart className="h-3 w-3" /> HR (bpm)</label>
                                        <Input value={vitals.heartRate} onChange={e => setVitals({ ...vitals, heartRate: e.target.value })} className="bg-slate-800 border-white/10 text-slate-100 font-mono" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 font-semibold"><Activity className="h-3 w-3" /> BP (sys/dia)</label>
                                        <div className="flex gap-2">
                                            <Input placeholder="120" value={vitals.systolic} onChange={e => setVitals({ ...vitals, systolic: e.target.value })} className="bg-slate-800 border-white/10 text-slate-100 font-mono" />
                                            <Input placeholder="80" value={vitals.diastolic} onChange={e => setVitals({ ...vitals, diastolic: e.target.value })} className="bg-slate-800 border-white/10 text-slate-100 font-mono" />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 font-semibold"><Thermometer className="h-3 w-3" /> Temp (°F)</label>
                                        <Input value={vitals.temperature} onChange={e => setVitals({ ...vitals, temperature: e.target.value })} className="bg-slate-800 border-white/10 text-slate-100 font-mono" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 font-semibold"><Wind className="h-3 w-3" /> SpO2 (%)</label>
                                        <Input value={vitals.oxygenSaturation} onChange={e => setVitals({ ...vitals, oxygenSaturation: e.target.value })} className="bg-slate-800 border-white/10 text-slate-100 font-mono" />
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {step === 3 && (
                            <motion.div
                                key="step3"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="space-y-6"
                            >
                                <div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Medical History</h2>
                                    <p className="text-slate-400">Relevant background information.</p>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-sm font-medium text-slate-300">Conditions & Context</label>
                                    <textarea
                                        value={medicalHistory}
                                        onChange={(e) => setMedicalHistory(e.target.value)}
                                        className="w-full h-32 rounded-xl bg-slate-800 border border-white/10 p-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/50 resize-none"
                                        placeholder="e.g. Hypertension, Smoker, Previous MI..."
                                    />
                                    <div className="pt-4 p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/10">
                                        <div className="flex items-start gap-3">
                                            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                                            <p className="text-sm text-yellow-200/80">Review all inputs before processing. AI triage offers decision support but does not replace clinical judgment.</p>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Actions */}
                <div className="p-6 border-t border-white/10 flex justify-between bg-slate-900/80">
                    {step > 1 ? (
                        <Button variant="ghost" onClick={prevStep} className="text-slate-400 hover:text-white">Back</Button>
                    ) : (
                        <div />
                    )}

                    {step < 3 ? (
                        <Button onClick={nextStep} className="bg-slate-700 hover:bg-slate-600 text-white">
                            Next Step <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    ) : (
                        <Button
                            onClick={handleSubmit}
                            disabled={loading || !chiefComplaint}
                            className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white shadow-lg shadow-red-900/20 px-8"
                        >
                            {loading ? "Analyzing..." : "Run Assessment"}
                        </Button>
                    )}
                </div>
            </div>

            {/* ─── RIGHT: Analysis Panel ───────────────────── */}
            <div className="flex-[1.2] bg-slate-950 p-6 md:p-10 overflow-y-auto relative">
                {/* Background Grid */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

                {!result ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                        {loading ? (
                            <motion.div
                                animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                                transition={{ repeat: Infinity, duration: 2 }}
                                className="flex flex-col items-center gap-4"
                            >
                                <Activity className="h-16 w-16 text-teal-400" />
                                <p className="text-xl font-medium text-teal-400">Processing Clinical Data...</p>
                                <p className="text-sm text-slate-400">Comparing against 5,000+ triage protocols</p>
                            </motion.div>
                        ) : (
                            <>
                                <Stethoscope className="h-24 w-24 text-slate-700 mb-6" />
                                <h2 className="text-2xl font-bold text-slate-300">Ready for Analysis</h2>
                                <p className="text-slate-500 max-w-sm mt-2">Complete the intake form to generate an ESI score, risk assessment, and differential diagnosis.</p>
                            </>
                        )}
                    </div>
                ) : (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-6 relative z-10"
                    >
                        {/* Header Result */}
                        <div className="flex justify-between items-start">
                            <div>
                                <h2 className="text-3xl font-bold text-white mb-1">Triage Result</h2>
                                <div className="flex items-center gap-2 text-slate-400 text-sm">
                                    <Clock className="h-3 w-3" /> Analysis complete in {(result.inferenceTimeMs / 1000).toFixed(1)}s
                                </div>
                            </div>
                            <Button size="sm" variant="outline" onClick={resetForm} className="border-white/10 hover:bg-white/5 text-slate-400">
                                <ListRestart className="mr-2 h-4 w-4" /> New Case
                            </Button>
                        </div>

                        {/* ESI Card */}
                        <div className={cn(
                            "relative overflow-hidden rounded-2xl p-8 border-2 transition-all",
                            ESI_COLORS[result.esiLevel]?.bg,
                            ESI_COLORS[result.esiLevel]?.border
                        )}>
                            <div className="relative z-10 flex cursor-default justify-between items-center">
                                <div>
                                    <p className="text-sm font-bold uppercase tracking-widest opacity-70 mb-1 text-white">Recommended Level</p>
                                    <h1 className={cn("text-6xl font-black", ESI_COLORS[result.esiLevel]?.text)}>ESI {result.esiLevel}</h1>
                                    <p className="text-xl font-medium text-white/90 mt-2">{ESI_COLORS[result.esiLevel]?.label}</p>
                                </div>
                                <div className="h-14 w-14 rounded-full border-4 border-white/20 flex items-center justify-center text-white/50 bg-black/20 font-bold backdrop-blur-md">
                                    {(result.confidence * 100).toFixed(0)}%
                                </div>
                            </div>
                        </div>

                        {/* Red Flags Grid */}
                        {result.redFlags.length > 0 && (
                            <div className="grid gap-4">
                                {result.redFlags.map((flag, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: i * 0.1 }}
                                        className="flex items-center gap-4 rounded-xl bg-red-500/10 border border-red-500/20 p-4"
                                    >
                                        <div className="h-10 w-10 shrink-0 rounded-full bg-red-500/20 flex items-center justify-center">
                                            <ShieldAlert className="h-5 w-5 text-red-400" />
                                        </div>
                                        <span className="font-medium text-red-200">{flag}</span>
                                    </motion.div>
                                ))}
                            </div>
                        )}

                        {/* Analysis Details */}
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6 backdrop-blur-sm">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Differential Diagnosis</h3>
                                <ul className="space-y-3">
                                    {result.differentialDiagnoses.map((dx, i) => (
                                        <li key={i} className="flex justify-between items-center text-sm border-b border-white/5 pb-2 last:border-0 last:pb-0">
                                            <span className="text-slate-200">{typeof dx === "string" ? dx : dx.diagnosis}</span>
                                            {typeof dx !== "string" && dx.probability && (
                                                <span className="text-teal-400 font-mono">{(dx.probability * 100).toFixed(0)}%</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6 backdrop-blur-sm">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">Suggested Workup</h3>
                                <div className="flex flex-wrap gap-2">
                                    {result.suggestedWorkup.map((w, i) => (
                                        <span key={i} className="px-3 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-xs font-medium text-slate-300">
                                            {w}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-teal-500/20 bg-teal-900/10 p-6">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-teal-400 mb-2">Clinical Reasoning</h3>
                            <p className="text-sm text-teal-100/80 leading-relaxed font-mono">
                                {result.reasoning}
                            </p>
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
