"use client";

import { useState } from "react";
import { Card, CardContent, Badge, Input, Button } from "@/components/ui";

// Demo patients matching the backend seed data
const DEMO_PATIENTS = [
    { id: "p1", first_name: "Maria", last_name: "Santos", mrn: "MRN-2024-0001", age: 52, gender: "Female", riskLevel: "HIGH", dept: "Cardiology", phone: "+1 555-0101" },
    { id: "p2", first_name: "James", last_name: "Thompson", mrn: "MRN-2024-0002", age: 68, gender: "Male", riskLevel: "MEDIUM", dept: "Pulmonology", phone: "+1 555-0102" },
    { id: "p3", first_name: "Aisha", last_name: "Patel", mrn: "MRN-2024-0003", age: 34, gender: "Female", riskLevel: "LOW", dept: "Obstetrics", phone: "+1 555-0103" },
    { id: "p4", first_name: "Robert", last_name: "Kim", mrn: "MRN-2024-0004", age: 45, gender: "Male", riskLevel: "MEDIUM", dept: "Neurology", phone: "+1 555-0104" },
    { id: "p5", first_name: "Elena", last_name: "Volkov", mrn: "MRN-2024-0005", age: 28, gender: "Female", riskLevel: "LOW", dept: "Dermatology", phone: "+1 555-0105" },
    { id: "p6", first_name: "David", last_name: "Okafor", mrn: "MRN-2024-0006", age: 61, gender: "Male", riskLevel: "HIGH", dept: "Oncology", phone: "+1 555-0106" },
    { id: "p7", first_name: "Sarah", last_name: "Johnson", mrn: "MRN-2024-0007", age: 73, gender: "Female", riskLevel: "HIGH", dept: "Cardiology", phone: "+1 555-0107" },
    { id: "p8", first_name: "Ahmed", last_name: "Hassan", mrn: "MRN-2024-0008", age: 55, gender: "Male", riskLevel: "MEDIUM", dept: "Endocrinology", phone: "+1 555-0108" },
    { id: "p9", first_name: "Lisa", last_name: "Chen", mrn: "MRN-2024-0009", age: 42, gender: "Female", riskLevel: "LOW", dept: "Rheumatology", phone: "+1 555-0109" },
    { id: "p10", first_name: "Michael", last_name: "Brown", mrn: "MRN-2024-0010", age: 38, gender: "Male", riskLevel: "LOW", dept: "General Medicine", phone: "+1 555-0110" },
];

const RISK_COLORS = {
    HIGH: "bg-red-500/10 text-red-600 border-red-500/20",
    MEDIUM: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    LOW: "bg-green-500/10 text-green-600 border-green-500/20",
};

export function PatientList() {
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const filtered = DEMO_PATIENTS.filter((p) =>
        `${p.first_name} ${p.last_name} ${p.mrn}`.toLowerCase().includes(search.toLowerCase())
    );

    const selected = DEMO_PATIENTS.find((p) => p.id === selectedId);

    return (
        <div className="h-full overflow-auto">
            <div className="max-w-6xl mx-auto p-6 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                            <span className="text-xl">👥</span>
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-foreground">Patient Dashboard</h1>
                            <p className="text-sm text-muted-foreground">{DEMO_PATIENTS.length} patients • AI-powered risk assessment</p>
                        </div>
                    </div>
                </div>

                {/* Search */}
                <div className="max-w-md">
                    <Input
                        placeholder="Search patients by name or MRN…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        { label: "Total Patients", value: DEMO_PATIENTS.length, color: "from-blue-500 to-indigo-500" },
                        { label: "High Risk", value: DEMO_PATIENTS.filter((p) => p.riskLevel === "HIGH").length, color: "from-red-500 to-pink-500" },
                        { label: "Medium Risk", value: DEMO_PATIENTS.filter((p) => p.riskLevel === "MEDIUM").length, color: "from-yellow-500 to-orange-500" },
                        { label: "Low Risk", value: DEMO_PATIENTS.filter((p) => p.riskLevel === "LOW").length, color: "from-green-500 to-emerald-500" },
                    ].map((stat) => (
                        <Card key={stat.label} className="overflow-hidden">
                            <div className={`h-1 bg-gradient-to-r ${stat.color}`} />
                            <CardContent className="pt-3">
                                <p className="text-2xl font-bold">{stat.value}</p>
                                <p className="text-xs text-muted-foreground">{stat.label}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Patient table */}
                <Card>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                                    <th className="text-left px-4 py-3 font-medium">Patient</th>
                                    <th className="text-left px-4 py-3 font-medium">MRN</th>
                                    <th className="text-left px-4 py-3 font-medium">Age/Sex</th>
                                    <th className="text-left px-4 py-3 font-medium">Department</th>
                                    <th className="text-left px-4 py-3 font-medium">Risk</th>
                                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((p) => (
                                    <tr
                                        key={p.id}
                                        onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
                                        className={`border-b border-border/50 cursor-pointer transition-colors ${selectedId === p.id ? "bg-primary/5" : "hover:bg-muted/50"
                                            }`}
                                    >
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                                                    {p.first_name[0]}{p.last_name[0]}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">{p.first_name} {p.last_name}</p>
                                                    <p className="text-xs text-muted-foreground">{p.phone}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm font-mono text-muted-foreground">{p.mrn}</td>
                                        <td className="px-4 py-3 text-sm">{p.age} / {p.gender[0]}</td>
                                        <td className="px-4 py-3 text-sm">{p.dept}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${RISK_COLORS[p.riskLevel as keyof typeof RISK_COLORS]}`}>
                                                {p.riskLevel}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Button variant="ghost" size="sm">View</Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* Quick info panel for selected patient */}
                {selected && (
                    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <CardContent className="pt-4">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold">
                                    {selected.first_name[0]}{selected.last_name[0]}
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold">{selected.first_name} {selected.last_name}</h3>
                                    <p className="text-sm text-muted-foreground">{selected.mrn} • {selected.dept}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="secondary" size="sm">📋 Generate Notes</Button>
                                    <Button variant="secondary" size="sm">🚨 Quick Triage</Button>
                                    <Button size="sm">🧠 AI Chat</Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
