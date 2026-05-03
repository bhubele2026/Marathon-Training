import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Clock } from "lucide-react";
import { WorkoutForm } from "@/components/workout-form";
import { LIFESTYLE_PRESETS } from "@/lib/lifestyle-presets";
import { LIFESTYLE_EQUIPMENT } from "@workspace/plan-generator";

interface QuickLogActivityProps {
  testIdSuffix?: string;
}

const RECENT_KEY = "quickLog.recentActivities.v1";
const MAX_RECENT = 4;

function getRecentActivities(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s: unknown) => typeof s === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function addRecentActivity(sessionType: string) {
  const recent = getRecentActivities().filter((s) => s !== sessionType);
  recent.unshift(sessionType);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export function QuickLogActivity({ testIdSuffix }: QuickLogActivityProps = {}) {
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogPreset, setQuickLogPreset] = useState<{ sessionType: string } | null>(null);
  const [recentActivities, setRecentActivities] = useState<string[]>([]);

  useEffect(() => {
    setRecentActivities(getRecentActivities());
  }, [quickLogOpen]);

  const openQuickLog = (sessionType: string | null) => {
    if (sessionType) addRecentActivity(sessionType);
    setQuickLogPreset(sessionType ? { sessionType } : null);
    setQuickLogOpen(true);
  };

  const suffix = testIdSuffix ? `-${testIdSuffix}` : "";

  const presetSessionTypes = new Set(LIFESTYLE_PRESETS.map((p) => p.sessionType));
  const recentOnly = recentActivities.filter((s) => !presetSessionTypes.has(s));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg uppercase tracking-wider">Quick Log Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {LIFESTYLE_PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <Button
                key={preset.label}
                variant="outline"
                className="h-auto py-3 flex flex-col gap-1 uppercase font-bold tracking-wider text-xs"
                onClick={() => openQuickLog(preset.sessionType)}
                data-testid={`button-quick-log-${preset.label.toLowerCase().replace(/\s+/g, "-")}${suffix}`}
              >
                <Icon className="h-5 w-5" />
                {preset.label}
              </Button>
            );
          })}
        </div>
        {recentOnly.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border space-y-1.5" data-testid="recent-activities">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
              <Clock className="h-3 w-3" />
              Recent
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {recentOnly.map((st) => (
                <Button
                  key={st}
                  variant="secondary"
                  size="sm"
                  className="text-xs uppercase font-bold tracking-wider h-auto py-2"
                  onClick={() => openQuickLog(st)}
                  data-testid={`button-quick-log-recent-${st.toLowerCase().replace(/\s+/g, "-")}${suffix}`}
                >
                  {st}
                </Button>
              ))}
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          className="w-full mt-2 uppercase font-bold tracking-wider text-xs"
          onClick={() => openQuickLog(null)}
          data-testid={`button-quick-log-custom${suffix}`}
        >
          <Plus className="h-4 w-4 mr-1" />
          Custom Activity
        </Button>

        <WorkoutForm
          open={quickLogOpen}
          onOpenChange={setQuickLogOpen}
          initial={{
            date: new Date().toISOString().split("T")[0],
            equipment: LIFESTYLE_EQUIPMENT,
            sessionType: quickLogPreset?.sessionType ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}
