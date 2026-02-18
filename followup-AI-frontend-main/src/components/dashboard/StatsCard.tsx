"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatsCardProps {
    title: string;
    value: string;
    trend?: string;
    trendDirection?: "up" | "down" | "neutral";
    icon: React.ReactNode;
    className?: string;
    delay?: number;
}

export function StatsCard({
    title,
    value,
    trend,
    trendDirection = "neutral",
    icon,
    className,
    delay = 0
}: StatsCardProps) {

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: delay * 0.1 }}
            className={cn(
                "relative overflow-hidden rounded-xl border border-white/5 bg-slate-900/50 p-6 backdrop-blur-sm",
                "hover:border-teal-500/30 hover:shadow-lg hover:shadow-teal-500/10 transition-all duration-300",
                className
            )}
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm font-medium text-slate-400">{title}</p>
                    <h3 className="mt-2 text-3xl font-bold text-slate-100 tracking-tight">{value}</h3>
                </div>
                <div className="rounded-lg bg-teal-500/10 p-2 text-teal-400">
                    {icon}
                </div>
            </div>

            {trend && (
                <div className="mt-4 flex items-center gap-2">
                    <span className={cn(
                        "flex items-center text-xs font-medium",
                        trendDirection === "up" ? "text-emerald-400" :
                            trendDirection === "down" ? "text-rose-400" : "text-slate-400"
                    )}>
                        {trendDirection === "up" ? <ArrowUpRight className="mr-1 h-3 w-3" /> :
                            trendDirection === "down" ? <ArrowDownRight className="mr-1 h-3 w-3" /> :
                                <Activity className="mr-1 h-3 w-3" />}
                        {trend}
                    </span>
                    <span className="text-xs text-slate-500">vs last month</span>
                </div>
            )}

            {/* Background Decorative Glow */}
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-teal-500/5 blur-2xl transition-all group-hover:bg-teal-500/10" />
        </motion.div>
    );
}
