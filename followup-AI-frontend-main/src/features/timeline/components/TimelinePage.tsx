"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Calendar,
    Activity,
    AlertTriangle,
    Lightbulb,
    FileText,
    Scan,
    Pill,
    Stethoscope,
    Sparkles,
    Loader2,
    User,
    TrendingUp,
    ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { getPatientTimeline } from "@/lib/ai-api";
import type { PatientTimelineResponse, TimelineEvent, TimelineInsight } from "@/types/ai";
import { cn } from "@/lib/utils";

const EVENT_ICONS: Record<string, typeof Calendar> = {
    VISIT: Stethoscope,
    LAB_RESULT: Activity,
    IMAGING: Scan,
    MEDICATION: Pill,
    PROCEDURE: Activity,
    NOTE: FileText,
    VITAL_SIGNS: Activity,
    VACCINATION: ShieldAlert,
};

const EVENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    VISIT: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
    LAB_RESULT: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
    IMAGING: { bg: "bg-pink-500/10", text: "text-pink-400", border: "border-pink-500/20" },
    MEDICATION: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
    PROCEDURE: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
    NOTE: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/20" },
    VITAL_SIGNS: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
    VACCINATION: { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/20" },
};

export function TimelinePage() {
    const [patientId, setPatientId] = useState("");
    const [clinicId, setClinicId] = useState("default-clinic");
    const [loading, setLoading] = useState(false);
    const [timeline, setTimeline] = useState<PatientTimelineResponse | null>(null);

    const handleLoadTimeline = async () => {
        if (!patientId) {
            alert("Please enter a patient ID");
            return;
        }

        setLoading(true);
        try {
            const result = await getPatientTimeline(patientId, clinicId, true);
            setTimeline(result);
        } catch (error: any) {
            console.error("Failed to load timeline:", error);
            alert(`Failed to load timeline: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const getInsightIcon = (type: string) => {
        switch (type) {
            case "trend":
                return TrendingUp;
            case "warning":
                return AlertTriangle;
            case "recommendation":
                return Lightbulb;
            default:
                return Sparkles;
        }
    };

    const getInsightColor = (severity: string) => {
        switch (severity) {
            case "critical":
                return { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/50" };
            case "warning":
                return { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/50" };
            default:
                return { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/50" };
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-950 overflow-hidden">
            {/* Header */}
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 bg-slate-900/50 px-6 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10">
                        <Calendar className="h-4 w-4 text-cyan-400" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-slate-100">LifeLine — Patient Health Timeline</h2>
                        <p className="text-xs text-slate-500">AI-curated longitudinal health view</p>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden flex flex-col p-6 gap-6">
                {/* Search Bar */}
                <div className="flex gap-4 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-300 mb-2">Patient ID</label>
                        <Input
                            value={patientId}
                            onChange={(e) => setPatientId(e.target.value)}
                            placeholder="Enter patient ID"
                            className="bg-slate-800 border-white/10 text-slate-100"
                            onKeyDown={(e) => e.key === "Enter" && handleLoadTimeline()}
                        />
                    </div>
                    <div className="w-48">
                        <label className="block text-sm font-medium text-slate-300 mb-2">Clinic ID</label>
                        <Input
                            value={clinicId}
                            onChange={(e) => setClinicId(e.target.value)}
                            placeholder="Clinic ID"
                            className="bg-slate-800 border-white/10 text-slate-100"
                        />
                    </div>
                    <Button
                        onClick={handleLoadTimeline}
                        disabled={loading || !patientId}
                        className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Loading...
                            </>
                        ) : (
                            <>
                                <Calendar className="mr-2 h-4 w-4" />
                                Load Timeline
                            </>
                        )}
                    </Button>
                </div>

                {loading && (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-4 opacity-60">
                        <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                        >
                            <Sparkles className="h-16 w-16 text-cyan-400" />
                        </motion.div>
                        <p className="text-lg font-medium text-cyan-400">Loading timeline...</p>
                        <p className="text-sm text-slate-500">Aggregating events and generating AI insights</p>
                    </div>
                )}

                {timeline && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex-1 overflow-y-auto space-y-6"
                    >
                        {/* Patient Header */}
                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6">
                            <div className="flex items-center gap-4">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10">
                                    <User className="h-6 w-6 text-cyan-400" />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white">{timeline.patientName}</h3>
                                    <p className="text-sm text-slate-400">Patient ID: {timeline.patientId}</p>
                                </div>
                            </div>
                        </div>

                        {/* AI Insights */}
                        {timeline.aiInsights.length > 0 && (
                            <div className="space-y-3">
                                <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                    <Sparkles className="h-4 w-4" />
                                    AI Insights
                                </h4>
                                {timeline.aiInsights.map((insight, i) => {
                                    const Icon = getInsightIcon(insight.type);
                                    const colors = getInsightColor(insight.severity);
                                    return (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.1 }}
                                            className={cn(
                                                "rounded-xl p-4 border-2 flex items-start gap-4",
                                                colors.bg,
                                                colors.border
                                            )}
                                        >
                                            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", colors.bg)}>
                                                <Icon className={cn("h-5 w-5", colors.text)} />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={cn("text-xs font-bold uppercase tracking-wider", colors.text)}>
                                                        {insight.type}
                                                    </span>
                                                    <span className={cn("text-xs px-2 py-0.5 rounded", colors.bg, colors.text)}>
                                                        {insight.severity}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-white">{insight.message}</p>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Timeline Events */}
                        <div className="space-y-3">
                            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                                Timeline Events ({timeline.events.length})
                            </h4>
                            <div className="relative">
                                {/* Timeline Line */}
                                <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-cyan-500/50 via-purple-500/50 to-pink-500/50" />

                                <div className="space-y-6">
                                    {timeline.events.map((event, i) => {
                                        const Icon = EVENT_ICONS[event.eventType] || Calendar;
                                        const colors = EVENT_COLORS[event.eventType] || EVENT_COLORS.NOTE;
                                        return (
                                            <motion.div
                                                key={event.id}
                                                initial={{ opacity: 0, x: -20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: i * 0.05 }}
                                                className="relative flex gap-4 pl-8"
                                            >
                                                {/* Timeline Dot */}
                                                <div className={cn(
                                                    "absolute left-4 top-2 h-4 w-4 rounded-full border-2 border-slate-900",
                                                    colors.bg,
                                                    colors.border
                                                )} />

                                                {/* Event Card */}
                                                <div className={cn(
                                                    "flex-1 rounded-xl border p-4",
                                                    colors.bg,
                                                    colors.border
                                                )}>
                                                    <div className="flex items-start justify-between mb-2">
                                                        <div className="flex items-center gap-3">
                                                            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", colors.bg)}>
                                                                <Icon className={cn("h-4 w-4", colors.text)} />
                                                            </div>
                                                            <div>
                                                                <h5 className="font-semibold text-white">{event.title}</h5>
                                                                <p className="text-xs text-slate-400">{formatDate(event.eventDate)}</p>
                                                            </div>
                                                        </div>
                                                        <span className={cn("text-xs px-2 py-1 rounded", colors.bg, colors.text)}>
                                                            {event.eventType.replace("_", " ")}
                                                        </span>
                                                    </div>

                                                    {event.description && (
                                                        <p className="text-sm text-slate-300 mt-2">{event.description}</p>
                                                    )}

                                                    {event.aiSummary && (
                                                        <div className="mt-3 pt-3 border-t border-white/5">
                                                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                                                                AI Summary
                                                            </p>
                                                            <p className="text-xs text-slate-400">{event.aiSummary}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {timeline.events.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 text-center opacity-40">
                                <Calendar className="h-16 w-16 text-slate-700 mb-4" />
                                <p className="text-slate-500">No timeline events found for this patient</p>
                            </div>
                        )}
                    </motion.div>
                )}

                {!timeline && !loading && (
                    <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                        <Calendar className="h-24 w-24 text-slate-700 mb-6" />
                        <h3 className="text-xl font-bold text-slate-300">No Timeline Loaded</h3>
                        <p className="text-slate-500 max-w-sm mt-2">
                            Enter a patient ID and click "Load Timeline" to view their health history with AI-powered insights.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
