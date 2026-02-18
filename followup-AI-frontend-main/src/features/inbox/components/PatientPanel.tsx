"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import type { Patient, Appointment, NoShowRiskLevel } from "@/types";

export interface PatientPanelProps {
  patient: Patient | null;
  upcomingAppointment: Appointment | null;
}

export function PatientPanel({ patient, upcomingAppointment }: PatientPanelProps) {
  if (!patient) {
    return (
      <div className="w-72 shrink-0 border-l border-border bg-muted/20 flex items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Select a conversation</p>
      </div>
    );
  }

  return (
    <div className="w-72 shrink-0 border-l border-border bg-muted/20 flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold text-foreground">{patient.name}</h3>
        {patient.phone && (
          <p className="text-xs text-muted-foreground mt-0.5">{patient.phone}</p>
        )}
        {patient.email && (
          <p className="text-xs text-muted-foreground">{patient.email}</p>
        )}
        <div className="flex flex-wrap gap-1 mt-2">
          {patient.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
        {patient.noShowRisk && (
          <div className="mt-2">
            <span className="text-xs text-muted-foreground mr-1">No-show risk:</span>
            <Badge risk={patient.noShowRisk as NoShowRiskLevel}>
              {patient.noShowRisk}
            </Badge>
          </div>
        )}
      </div>
      {upcomingAppointment && (
        <Card className="m-4 mt-2">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Upcoming appointment</CardTitle>
          </CardHeader>
          <CardContent className="py-0 pt-0 space-y-1 text-sm">
            <p>
              {new Date(upcomingAppointment.scheduledAt).toLocaleString()}
            </p>
            {upcomingAppointment.serviceName && (
              <p className="text-muted-foreground">{upcomingAppointment.serviceName}</p>
            )}
            <Badge variant="secondary">{upcomingAppointment.status}</Badge>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
