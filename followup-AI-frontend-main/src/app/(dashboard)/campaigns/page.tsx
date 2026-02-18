import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

export default function CampaignsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-foreground mb-6">Campaigns</h1>
      <Card>
        <CardHeader>
          <CardTitle>Phase 2</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Campaign / cadence setup and A/B variants will be built in a later phase.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
