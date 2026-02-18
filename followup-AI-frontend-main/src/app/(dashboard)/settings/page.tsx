import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

export default function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-foreground mb-6">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Clinic & location</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Clinic, location, and channel settings will be configured here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
