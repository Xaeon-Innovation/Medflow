"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Upload,
    Scan,
    AlertCircle,
    CheckCircle2,
    Clock,
    FileImage,
    Sparkles,
    Loader2,
    Download,
    Eye,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { uploadImage, analyzeImage, getImagingReport } from "@/lib/ai-api";
import type { ImagingModality, ImagingAnalysisResponse, UrgencyLevel } from "@/types/ai";
import { cn } from "@/lib/utils";

const MODALITIES: { value: ImagingModality; label: string; icon: typeof Scan }[] = [
    { value: "XRAY", label: "X-Ray", icon: Scan },
    { value: "CT", label: "CT Scan", icon: Scan },
    { value: "MRI", label: "MRI", icon: Scan },
    { value: "ULTRASOUND", label: "Ultrasound", icon: Scan },
    { value: "DERM", label: "Dermatology", icon: FileImage },
    { value: "OPHTHO", label: "Ophthalmology", icon: Eye },
    { value: "PATHOLOGY", label: "Pathology", icon: Scan },
];

const URGENCY_COLORS: Record<UrgencyLevel, { bg: string; text: string; border: string }> = {
    STAT: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/50" },
    URGENT: { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/50" },
    ROUTINE: { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/50" },
    INCIDENTAL: { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/50" },
};

export function ImagingPage() {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [modality, setModality] = useState<ImagingModality>("XRAY");
    const [bodyRegion, setBodyRegion] = useState("");
    const [clinicalContext, setClinicalContext] = useState("");
    const [patientId, setPatientId] = useState("");
    const [uploading, setUploading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [imageId, setImageId] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<ImagingAnalysisResponse | null>(null);
    const [dragActive, setDragActive] = useState(false);

    const handleFileSelect = useCallback((file: File) => {
        if (!file.type.startsWith("image/")) {
            alert("Please select an image file");
            return;
        }
        setSelectedFile(file);
        const reader = new FileReader();
        reader.onloadend = () => {
            setPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
    }, []);

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    }, [handleFileSelect]);

    const handleUpload = async () => {
        if (!selectedFile || !patientId) {
            alert("Please select an image and enter a patient ID");
            return;
        }

        setUploading(true);
        try {
            const result = await uploadImage(selectedFile, {
                clinicId: "default-clinic",
                patientId,
                modality,
                bodyRegion: bodyRegion || undefined,
                clinicalContext: clinicalContext || undefined,
            });
            setImageId(result.id);
            // Auto-trigger analysis
            await handleAnalyze(result.id);
        } catch (error: any) {
            console.error("Upload failed:", error);
            alert(`Upload failed: ${error.message}`);
        } finally {
            setUploading(false);
        }
    };

    const handleAnalyze = async (imgId?: string) => {
        const id = imgId || imageId;
        if (!id) return;

        setAnalyzing(true);
        try {
            const result = await analyzeImage(id, clinicalContext || undefined);
            setAnalysis(result);
        } catch (error: any) {
            console.error("Analysis failed:", error);
            alert(`Analysis failed: ${error.message}`);
        } finally {
            setAnalyzing(false);
        }
    };

    const reset = () => {
        setSelectedFile(null);
        setPreview(null);
        setImageId(null);
        setAnalysis(null);
        setBodyRegion("");
        setClinicalContext("");
    };

    return (
        <div className="flex h-full flex-col bg-slate-950 overflow-hidden">
            {/* Header */}
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 bg-slate-900/50 px-6 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
                        <Scan className="h-4 w-4 text-purple-400" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-slate-100">MedVision — Radiology AI</h2>
                        <p className="text-xs text-slate-500">Powered by MedGemma 4B Multimodal</p>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden grid grid-cols-2 gap-6 p-6">
                {/* Left: Upload & Image */}
                <div className="flex flex-col gap-4 overflow-y-auto">
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-white">Upload Medical Image</h3>

                        {/* Patient ID */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Patient ID <span className="text-red-400">*</span>
                            </label>
                            <Input
                                value={patientId}
                                onChange={(e) => setPatientId(e.target.value)}
                                placeholder="Enter patient ID"
                                className="bg-slate-800 border-white/10 text-slate-100"
                            />
                        </div>

                        {/* Modality & Body Region */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Modality</label>
                                <Select
                                    value={modality}
                                    onChange={(e) => setModality(e.target.value as ImagingModality)}
                                    className="bg-slate-800 border-white/10 text-slate-100"
                                    options={MODALITIES.map((m) => ({ value: m.value, label: m.label }))}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Body Region</label>
                                <Input
                                    value={bodyRegion}
                                    onChange={(e) => setBodyRegion(e.target.value)}
                                    placeholder="e.g. Chest, Abdomen"
                                    className="bg-slate-800 border-white/10 text-slate-100"
                                />
                            </div>
                        </div>

                        {/* Clinical Context */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">Clinical Context</label>
                            <textarea
                                value={clinicalContext}
                                onChange={(e) => setClinicalContext(e.target.value)}
                                placeholder="Optional: Brief clinical history or indication..."
                                rows={3}
                                className="w-full rounded-xl bg-slate-800 border border-white/10 p-3 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
                            />
                        </div>

                        {/* Upload Area */}
                        <div
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                            className={cn(
                                "relative border-2 border-dashed rounded-2xl p-8 transition-all",
                                dragActive
                                    ? "border-purple-500/50 bg-purple-500/10"
                                    : "border-white/10 bg-slate-900/50 hover:border-white/20"
                            )}
                        >
                            {preview ? (
                                <div className="relative">
                                    <img
                                        src={preview}
                                        alt="Preview"
                                        className="w-full h-auto rounded-xl max-h-96 object-contain"
                                    />
                                    <button
                                        onClick={reset}
                                        className="absolute top-2 right-2 p-2 rounded-full bg-red-500/20 hover:bg-red-500/30 text-red-400"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center text-center space-y-4">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-purple-500/10">
                                        <Upload className="h-8 w-8 text-purple-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-slate-200">
                                            Drag & drop an image here
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">or click to browse</p>
                                    </div>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                                        className="hidden"
                                        id="file-upload"
                                    />
                                    <label htmlFor="file-upload">
                                        <Button
                                            variant="outline"
                                            className="border-white/10 hover:bg-white/5 text-slate-300"
                                        >
                                            Select File
                                        </Button>
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* Upload Button */}
                        {selectedFile && patientId && (
                            <Button
                                onClick={handleUpload}
                                disabled={uploading || analyzing}
                                className="w-full bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white"
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="mr-2 h-4 w-4" />
                                        Upload & Analyze
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>

                {/* Right: Analysis Results */}
                <div className="flex flex-col gap-4 overflow-y-auto">
                    <h3 className="text-lg font-semibold text-white">AI Analysis Report</h3>

                    {analyzing && (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-60">
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                            >
                                <Sparkles className="h-16 w-16 text-purple-400" />
                            </motion.div>
                            <p className="text-lg font-medium text-purple-400">Analyzing image...</p>
                            <p className="text-sm text-slate-500">MedGemma 4B Multimodal processing</p>
                        </div>
                    )}

                    {analysis && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-6"
                        >
                            {/* Urgency Badge */}
                            <div
                                className={cn(
                                    "rounded-2xl p-6 border-2",
                                    URGENCY_COLORS[analysis.urgencyLevel].bg,
                                    URGENCY_COLORS[analysis.urgencyLevel].border
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">
                                            Urgency Level
                                        </p>
                                        <h2 className={cn("text-3xl font-black", URGENCY_COLORS[analysis.urgencyLevel].text)}>
                                            {analysis.urgencyLevel}
                                        </h2>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-slate-400 mb-1">Confidence</p>
                                        <p className="text-2xl font-bold text-white">
                                            {(analysis.overallConfidence * 100).toFixed(0)}%
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Findings */}
                            {analysis.findings.length > 0 && (
                                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6">
                                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
                                        Findings
                                    </h4>
                                    <div className="space-y-3">
                                        {analysis.findings.map((finding, i) => (
                                            <div
                                                key={i}
                                                className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border border-white/5"
                                            >
                                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-500/20">
                                                    <CheckCircle2 className="h-3 w-3 text-purple-400" />
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium text-slate-200">{finding.finding}</p>
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        Location: {finding.location} • Severity: {finding.severity}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Impression */}
                            <div className="rounded-2xl border border-teal-500/20 bg-teal-900/10 p-6">
                                <h4 className="text-sm font-bold uppercase tracking-wider text-teal-400 mb-3">
                                    Impression
                                </h4>
                                <p className="text-sm text-teal-100/80 leading-relaxed">{analysis.impression}</p>
                            </div>

                            {/* Recommendations */}
                            {analysis.recommendations.length > 0 && (
                                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6">
                                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">
                                        Recommendations
                                    </h4>
                                    <ul className="space-y-2">
                                        {analysis.recommendations.map((rec, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                                                <span className="text-purple-400 mt-1">•</span>
                                                <span>{rec}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Metadata */}
                            <div className="flex items-center justify-between text-xs text-slate-500 pt-4 border-t border-white/5">
                                <div className="flex items-center gap-4">
                                    <span className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {(analysis.inferenceTimeMs / 1000).toFixed(1)}s
                                    </span>
                                    <span>Model: {analysis.modelUsed}</span>
                                </div>
                                <span className="text-slate-600">Status: {analysis.reviewStatus}</span>
                            </div>
                        </motion.div>
                    )}

                    {!analysis && !analyzing && (
                        <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                            <Scan className="h-24 w-24 text-slate-700 mb-6" />
                            <h3 className="text-xl font-bold text-slate-300">No Analysis Yet</h3>
                            <p className="text-slate-500 max-w-sm mt-2">
                                Upload an image and click "Upload & Analyze" to generate an AI-powered radiology report.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
