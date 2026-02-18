import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

export default function AnalyticsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-foreground mb-6">Analytics</h1>
      <Card>
        <CardHeader>
          <CardTitle>Placeholder</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Charts and per-location metrics will go here in a later phase.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
