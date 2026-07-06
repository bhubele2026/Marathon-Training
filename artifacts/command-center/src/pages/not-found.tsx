import { AlertCircle } from "lucide-react";
import { PageBackdrop } from "@/components/studio";

export default function NotFound() {
  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-background px-4">
      <PageBackdrop motif="barbell" hero />
      <div className="relative z-10 max-w-md text-center space-y-3">
        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" />
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Page not found
        </h1>
        <p className="text-sm text-muted-foreground">
          That page doesn&apos;t exist or has moved.
        </p>
      </div>
    </div>
  );
}
