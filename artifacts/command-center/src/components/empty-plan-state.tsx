import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wand2 } from "lucide-react";

// Task #307. Shared empty-state surface used by /, /today, /plan, and
// /plan/:week whenever no Phase Planner config has been applied (fresh
// install or post-Full-Reset with empty planner_configs). Always links
// the runner to /planner so they can build their first plan.
export function EmptyPlanState({
  title = "No plan yet",
  description = "Build your first training plan in the Phase Planner — pick programs, set the dates, and apply to populate your weekly schedule.",
  testId = "empty-plan-state",
}: {
  title?: string;
  description?: string;
  testId?: string;
}) {
  const [, navigate] = useLocation();
  return (
    <Card
      className="border-dashed border-2 bg-muted/30"
      data-testid={testId}
    >
      <CardContent className="p-12 text-center space-y-4">
        <Wand2 className="h-12 w-12 mx-auto text-primary opacity-70" />
        <div className="space-y-2">
          <h3 className="text-xl font-black tracking-wider">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            {description}
          </p>
        </div>
        <Button
          size="lg"
          className="font-bold tracking-wider"
          onClick={() => navigate("/planner")}
          data-testid={`${testId}-cta`}
        >
          <Wand2 className="h-4 w-4 mr-2" />
          Open Phase Planner
        </Button>
      </CardContent>
    </Card>
  );
}
