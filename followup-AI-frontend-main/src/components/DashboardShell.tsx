"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getClinicLocations } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select"; // Changed from select-native as it doesn't exist, using Select from UI
import type { SelectOption } from "@/components/ui/Select";
import { Sidebar } from "@/components/layout/Sidebar";
import { Bell, Search, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

// Fallback if ui/select-native doesn't exist, we'll check imports later.
// Actually, looking at previous DashboardShell, it imported { Select } from "@/components/ui".
// I'll stick to that.

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: getClinicLocations,
  });

  useEffect(() => {
    if (locations.length > 0 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, selectedLocationId]);

  const locationOptions = locations.map((loc) => ({
    value: loc.id,
    label: loc.name,
  }));

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Global Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative">

        {/* Glassmorphic Header */}
        <header className="flex h-16 items-center justify-between border-b border-white/5 bg-slate-900/50 px-6 backdrop-blur-xl shrink-0 z-40">

          {/* Left: Mobile Toggle & Context */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="md:hidden text-slate-400">
              <Menu className="h-5 w-5" />
            </Button>

            {/* Location Selector (Styled) */}
            <div className="relative group">
              <select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="bg-transparent border border-white/10 rounded-full py-1.5 pl-3 pr-8 text-sm font-medium text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/50 hover:bg-white/5 transition-all appearance-none cursor-pointer"
              >
                {locations.length === 0 && <option>Loading locations...</option>}
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id} className="bg-slate-900 text-slate-200">
                    {loc.name}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>

          {/* Right: Global Actions & Profile */}
          <div className="flex items-center gap-4">
            {/* Search Bar */}
            <div className="hidden md:flex items-center relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search patients, vitals..."
                className="h-9 w-64 rounded-full bg-slate-800/50 border border-white/5 pl-9 pr-4 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-teal-500/50 transition-all"
              />
            </div>

            {/* Notifications */}
            <Button variant="ghost" size="icon" className="relative text-slate-400 hover:text-teal-400 hover:bg-teal-500/10">
              <Bell className="h-5 w-5" />
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-slate-900 animate-pulse" />
            </Button>

            {/* User Profile */}
            <div className="flex items-center gap-3 pl-2 border-l border-white/10">
              <div className="text-right hidden md:block">
                <div className="text-sm font-medium text-slate-200">Dr. Sarah Chen</div>
                <div className="text-xs text-teal-400">Emergency Dept</div>
              </div>
              <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-teal-500 to-cyan-500 p-[1px] shadow-lg shadow-teal-500/20">
                <div className="h-full w-full rounded-full bg-slate-900 p-0.5">
                  <img
                    src="/api/placeholder/32/32"
                    alt="User"
                    className="h-full w-full rounded-full object-cover bg-slate-800"
                  />
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Scrollable Main Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-gradient-to-br from-slate-950 to-slate-900/50 relative">
          {/* Background Grid Effect */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

          <div className="relative z-10 p-6 md:p-8 max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
