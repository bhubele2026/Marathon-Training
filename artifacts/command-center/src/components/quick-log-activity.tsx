import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dog, Trees, Home, Mountain, Plus } from "lucide-react";
import { WorkoutForm } from "@/components/workout-form";

type LifestylePreset = {
  label: string;
  icon: typeof Dog;
  sessionType: string;
};

const LIFESTYLE_PRESETS: LifestylePreset[] = [
  { label: "Walk Dogs", icon: Dog, sessionType: "Dog Walk" },
  { label: "Mow Lawn", icon: Trees, sessionType: "Yard Work" },
  { label: "Yard Work", icon: Home, sessionType: "Yard Work" },
  { label: "Hike", icon: Mountain, sessionType: "Hike" },
];

interface QuickLogActivityProps {
  testIdSuffix?: string;
}

export function QuickLogActivity({ testIdSuffix }: QuickLogActivityProps = {}) {
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogPreset, setQuickLogPreset] = useState<{ sessionType: string } | null>(null);

  const openQuickLog = (sessionType: string | null) => {
    setQuickLogPreset(sessionType ? { sessionType } : null);
    setQuickLogOpen(true);
  };

  const suffix = testIdSuffix ? `-${testIdSuffix}` : "";

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
            equipment: "Lifestyle",
            sessionType: quickLogPreset?.sessionType ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}
