"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
    Bot,
    Siren,
    Users,
    Inbox,
    Megaphone,
    BarChart2,
    Settings,
    ChevronLeft,
    ChevronRight,
    Activity,
    Search,
    Command,
    Scan,
    FileText,
    Calendar
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { motion, AnimatePresence } from "framer-motion";

const navItems = [
    { href: "/ai-chat", label: "AI Copilot", icon: Bot, group: "Clinical" },
    { href: "/triage", label: "Triage", icon: Siren, group: "Clinical" },
    { href: "/imaging", label: "Imaging", icon: Scan, group: "Clinical" },
    { href: "/docs", label: "Clinical Docs", icon: FileText, group: "Clinical" },
    { href: "/timeline", label: "Timeline", icon: Calendar, group: "Clinical" },
    { href: "/patients", label: "Patients", icon: Users, group: "Clinical" },
    { href: "/inbox", label: "Inbox", icon: Inbox, group: "Admin" },
    { href: "/campaigns", label: "Campaigns", icon: Megaphone, group: "Admin" },
    { href: "/analytics", label: "Analytics", icon: BarChart2, group: "Admin" },
    { href: "/settings", label: "Settings", icon: Settings, group: "System" },
];

export function Sidebar() {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    return (
        <motion.aside
            initial={{ width: 256 }}
            animate={{ width: collapsed ? 80 : 256 }}
            className={cn(
                "relative z-50 flex flex-col border-r border-white/10 bg-slate-900/50 backdrop-blur-xl h-screen",
                "transition-all duration-300 ease-in-out"
            )}
        >
            {/* Logo Area */}
            <div className="flex h-16 items-center border-b border-white/10 px-4">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 shadow-lg shadow-teal-500/20">
                        <Activity className="h-5 w-5 text-white" />
                    </div>
                    <motion.span
                        animate={{ opacity: collapsed ? 0 : 1, width: collapsed ? 0 : 'auto' }}
                        className="whitespace-nowrap font-bold text-lg tracking-tight text-white"
                    >
                        MedFlow AI
                    </motion.span>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
                {["Clinical", "Admin", "System"].map((group) => {
                    const items = navItems.filter(item => item.group === group);
                    if (items.length === 0) return null;

                    return (
                        <div key={group}>
                            {!collapsed && (
                                <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                    {group}
                                </h3>
                            )}
                            <div className="space-y-1">
                                {items.map((item) => {
                                    const isActive = pathname === item.href;
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            className={cn(
                                                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                                                isActive
                                                    ? "bg-teal-500/10 text-teal-400 shadow-[0_0_15px_-3px_rgba(20,184,166,0.2)] border border-teal-500/20"
                                                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
                                            )}
                                        >
                                            <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-teal-400")} />
                                            {!collapsed && <span>{item.label}</span>}
                                            {collapsed && isActive && (
                                                <div className="absolute left-16 z-50 rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-xl border border-white/10 ml-2">
                                                    {item.label}
                                                </div>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer / User Profile Stub */}
            <div className="border-t border-white/10 p-3">
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex w-full items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
                >
                    {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                </button>
            </div>
        </motion.aside>
    );
}
