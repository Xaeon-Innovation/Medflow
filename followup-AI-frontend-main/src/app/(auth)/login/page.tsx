import Link from "next/link";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to ReactivateAI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-foreground">
              Email
            </label>
            <Input id="email" type="email" placeholder="you@clinic.com" />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-foreground">
              Password
            </label>
            <Input id="password" type="password" placeholder="••••••••" />
          </div>
          <Link href="/inbox" className="block">
            <Button fullWidth className="w-full">Sign in</Button>
          </Link>
          <p className="text-center text-sm text-muted-foreground">
            Placeholder login – no backend yet.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
