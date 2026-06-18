import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Clock } from "lucide-react";
import { WorkoutForm } from "@/components/workout-form";
import { LIFESTYLE_PRESETS } from "@/lib/lifestyle-presets";
import { LIFESTYLE_EQUIPMENT } from "@workspace/plan-generator";
import { useGetRecentLifestyleActivities } from "@workspace/api-client-react";
import {
  sortPresetsByRecent,
  getRecentNonPresetActivities,
} from "@/lib/recent-activities";

interface QuickLogActivityProps {
  testIdSuffix?: string;
}

export function QuickLogActivity({ testIdSuffix }: QuickLogActivityProps = {}) {
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogPreset, setQuickLogPreset] = useState<{ sessionType: string } | null>(null);
  const { data: recent } = useGetRecentLifestyleActivities();
  const recentActivities = recent ?? [];

  const openQuickLog = (sessionType: string | null) => {
    setQuickLogPreset(sessionType ? { sessionType } : null);
    setQuickLogOpen(true);
  };

  const suffix = testIdSuffix ? `-${testIdSuffix}` : "";

  const orderedPresets = sortPresetsByRecent(LIFESTYLE_PRESETS, recentActivities);
  const recentOnly = getRecentNonPresetActivities(recentActivities);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg tracking-wider">Quick Log Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2" data-testid={`quick-log-presets${suffix}`}>
          {orderedPresets.map((preset) => {
            const Icon = preset.icon;
            return (
              <Button
                key={preset.label}
                variant="outline"
                className="h-auto py-3 flex flex-col gap-1 font-bold tracking-wider text-xs"
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
            <div className="flex items-center gap-1.5 text-[10px] tracking-wider font-bold text-muted-foreground">
              <Clock className="h-3 w-3" />
              Recent
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {recentOnly.map((st) => (
                <Button
                  key={st}
                  variant="secondary"
                  size="sm"
                  className="text-xs font-bold tracking-wider h-auto py-2"
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
          className="w-full mt-2 font-bold tracking-wider text-xs"
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
