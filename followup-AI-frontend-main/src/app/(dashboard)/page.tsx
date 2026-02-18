import { StatsCard } from "@/components/dashboard/StatsCard";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { Activity, Users, Clock, AlertTriangle } from "lucide-react";

export default function DashboardPage() {
    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-white">Dashboard Overview</h2>
                <p className="text-slate-400">Welcome back, Dr. Sarah. Here's what's happening at Central Main.</p>
            </div>

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <StatsCard
                    title="Active Patients"
                    value="42"
                    icon={<Users className="h-5 w-5" />}
                    trend="+12%"
                    trendDirection="up"
                    delay={0}
                />
                <StatsCard
                    title="Avg Triage Time"
                    value="4m 12s"
                    icon={<Clock className="h-5 w-5" />}
                    trend="-30s"
                    trendDirection="up" // Interpreted as "good"
                    delay={1}
                />
                <StatsCard
                    title="Critical Alerts"
                    value="3"
                    icon={<AlertTriangle className="h-5 w-5" />}
                    trend="+1"
                    trendDirection="down" // down meaning "bad" direction visually (red)
                    className="border-rose-500/20 bg-rose-500/5"
                    delay={2}
                />
                <StatsCard
                    title="AI Consults"
                    value="128"
                    icon={<Activity className="h-5 w-5" />}
                    trend="+24%"
                    trendDirection="up"
                    delay={3}
                />
            </div>

            {/* Main Content Split: Table & Feed */}
            <div className="grid gap-6 md:grid-cols-7">

                {/* Left: Patient List Preview (Placeholder for SmartTable) */}
                <div className="col-span-4 rounded-xl border border-white/5 bg-slate-900/50 p-6 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-slate-100">Recent Triage Cases</h3>
                        <button className="text-xs text-teal-400 hover:text-teal-300">View All</button>
                    </div>

                    <div className="space-y-3">
                        {[1, 2, 3].map((_, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-transparent hover:border-white/10 cursor-pointer">
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">JD</div>
                                    <div>
                                        <div className="text-sm font-medium text-slate-200">John Doe</div>
                                        <div className="text-xs text-slate-500">Chest Pain • ESI 2</div>
                                    </div>
                                </div>
                                <div className="px-2 py-1 rounded-full bg-rose-500/20 text-rose-400 text-xs font-medium">Critical</div>
                            </div>
                        ))}
                        {[4, 5].map((_, i) => (
                            <div key={i + 4} className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-transparent hover:border-white/10 cursor-pointer">
                                <div className="flex items-center gap-3">
                                    <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">AS</div>
                                    <div>
                                        <div className="text-sm font-medium text-slate-200">Alice Smith</div>
                                        <div className="text-xs text-slate-500">Headache • ESI 4</div>
                                    </div>
                                </div>
                                <div className="px-2 py-1 rounded-full bg-teal-500/20 text-teal-400 text-xs font-medium">Standard</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right: Activity Feed */}
                <div className="col-span-3">
                    <ActivityFeed />
                </div>
            </div>
        </div>
    );
}
