"use client";

import { motion } from "framer-motion";
import { UserPlus, AlertTriangle, FileText, CheckCircle2 } from "lucide-react";

const activities = [
    {
        id: 1,
        type: "new_patient",
        message: "New patient admitted: John Doe",
        time: "2 mins ago",
        icon: UserPlus,
        color: "text-blue-400",
        bg: "bg-blue-500/10",
    },
    {
        id: 2,
        type: "alert",
        message: "High urgency triage: Chest Pain",
        time: "15 mins ago",
        icon: AlertTriangle,
        color: "text-rose-400",
        bg: "bg-rose-500/10",
    },
    {
        id: 3,
        type: "report",
        message: "Clinical report generated",
        time: "1 hour ago",
        icon: FileText,
        color: "text-purple-400",
        bg: "bg-purple-500/10",
    },
    {
        id: 4,
        type: "complete",
        message: "Vitals check completed",
        time: "2 hours ago",
        icon: CheckCircle2,
        color: "text-emerald-400",
        bg: "bg-emerald-500/10",
    },
];

export function ActivityFeed() {
    return (
        <div className="rounded-xl border border-white/5 bg-slate-900/50 p-6 backdrop-blur-sm">
            <h3 className="mb-4 text-lg font-semibold text-slate-100">Recent Activity</h3>
            <div className="space-y-4">
                {activities.map((activity, index) => (
                    <motion.div
                        key={activity.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="flex items-start gap-3"
                    >
                        <div className={`mt-0.5 rounded-full p-1.5 ${activity.bg} ${activity.color}`}>
                            <activity.icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-medium text-slate-200">{activity.message}</p>
                            <p className="text-xs text-slate-500">{activity.time}</p>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
