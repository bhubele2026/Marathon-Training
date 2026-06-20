import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Stethoscope, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// The "what's going on" panel. Generated on demand (button) so the AI narration
// only runs when the runner asks; the server persists the latest keyed on a hash
// of the metrics, so repeat opens are cheap. The diagnosis substance is the
// server analyzer (progress-diagnosis.ts); this just renders it in the coach's
// voice with tone-appropriate colour.

type Finding = {
  id: string;
  rank: number;
  tone: "supportive" | "sassy" | "neutral" | "positive";
  title: string;
  cause: string;
  fix: string;
};

type Diagnosis = {
  weeks: number;
  headline: string;
  findings: Finding[];
  narrative: string | null;
  generatedAt: string;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const TONE: Record<Finding["tone"], string> = {
  supportive: "border-l-sky-500 bg-sky-500/10",
  positive: "border-l-emerald-500 bg-emerald-500/10",
  sassy: "border-l-amber-500 bg-amber-500/10",
  neutral: "border-l-muted-foreground bg-muted/40",
};

export function ProgressDiagnosis({ weeks = 12 }: { weeks?: number }) {
  const [show, setShow] = useState(false);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["/api/progress/diagnosis", weeks],
    queryFn: () => getJson<Diagnosis>(`/api/progress/diagnosis?weeks=${weeks}`),
    enabled: show,
  });

  if (!show) {
    return (
      <Card data-testid="progress-diagnosis-cta">
        <CardContent className="p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Stethoscope className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-bold tracking-wider">What's going on?</p>
              <p className="text-xs text-muted-foreground">
                Get the coach's read on your last {weeks} weeks — what the numbers say and what to change.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="font-bold tracking-wider"
            onClick={() => setShow(true)}
            data-testid="button-run-diagnosis"
          >
            Diagnose
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="progress-diagnosis">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-bold uppercase tracking-[0.12em] flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-primary" /> What's going on
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-recheck-diagnosis"
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Couldn't load the diagnosis.</p>
        ) : (
          <>
            {data.narrative && (
              <p className="text-base leading-relaxed" data-testid="diagnosis-narrative">
                {data.narrative}
              </p>
            )}
            <div className="space-y-2">
              {data.findings.map((f) => (
                <div
                  key={f.id}
                  className={cn("rounded-md border-l-4 px-4 py-3", TONE[f.tone])}
                  data-testid={`diagnosis-finding-${f.id}`}
                  data-tone={f.tone}
                >
                  <p className="text-sm font-black tracking-tight">{f.title}</p>
                  <p className="text-sm text-muted-foreground mt-1">{f.cause}</p>
                  <p className="text-sm mt-1">
                    <span className="font-bold">Fix:</span> {f.fix}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
