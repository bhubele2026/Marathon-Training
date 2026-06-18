import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkoutForm } from "@/components/workout-form";
import { LIFESTYLE_PRESETS } from "@/lib/lifestyle-presets";
import { LIFESTYLE_EQUIPMENT } from "@workspace/plan-generator";
import { useGetRecentLifestyleActivities } from "@workspace/api-client-react";
import { sortPresetsByRecent } from "@/lib/recent-activities";

export function QuickLogFab() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [preset, setPreset] = useState<{ sessionType: string } | null>(null);
  const { data: recent } = useGetRecentLifestyleActivities();

  const openForm = (sessionType: string | null) => {
    setPreset(sessionType ? { sessionType } : null);
    setSheetOpen(false);
    setFormOpen(true);
  };

  const orderedPresets = sortPresetsByRecent(LIFESTYLE_PRESETS, recent ?? []);

  return (
    <>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button
            size="icon"
            className="md:hidden fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label="Quick log activity"
            data-testid="button-quick-log-fab"
          >
            <Plus className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="tracking-wider text-left">
              Quick Log Activity
            </SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2 mt-4" data-testid="quick-log-fab-presets">
            {orderedPresets.map((p) => {
              const Icon = p.icon;
              return (
                <Button
                  key={p.label}
                  variant="outline"
                  className="h-auto py-3 flex flex-col gap-1 font-bold tracking-wider text-xs"
                  onClick={() => openForm(p.sessionType)}
                  data-testid={`button-quick-log-fab-${p.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <Icon className="h-5 w-5" />
                  {p.label}
                </Button>
              );
            })}
          </div>
          <Button
            variant="ghost"
            className="w-full mt-2 font-bold tracking-wider text-xs"
            onClick={() => openForm(null)}
            data-testid="button-quick-log-fab-custom"
          >
            <Plus className="h-4 w-4 mr-1" />
            Custom Activity
          </Button>
        </SheetContent>
      </Sheet>

      <WorkoutForm
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={{
          date: new Date().toISOString().split("T")[0],
          equipment: LIFESTYLE_EQUIPMENT,
          sessionType: preset?.sessionType ?? "",
        }}
      />
    </>
  );
}
