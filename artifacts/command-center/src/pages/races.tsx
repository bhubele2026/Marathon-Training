import { useState } from "react";
import {
  useListRaceResults,
  useUpdateRaceResult,
  useDeleteRaceResult,
  getListRaceResultsQueryKey,
  getGetRaceWeekQueryKey,
  type RaceResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Trophy, Pencil, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/format";

const RACE_KIND_LABELS: Record<string, string> = {
  marathon: "Marathon",
  half: "Half Marathon",
  "10k": "10K",
  "5k": "5K",
};

function feltLabel(rating: number | null | undefined): string {
  if (rating == null) return "—";
  return `${rating}/5`;
}

function placementText(r: RaceResult): string {
  if (r.placementOverall == null) return "—";
  if (r.placementTotal != null) return `${r.placementOverall} of ${r.placementTotal}`;
  return String(r.placementOverall);
}

interface EditState {
  raceDate: string;
  finishTime: string;
  placementOverall: string;
  placementTotal: string;
  feltRating: string;
  notes: string;
}

function toEditState(r: RaceResult): EditState {
  return {
    raceDate: r.raceDate,
    finishTime: r.finishTime ?? "",
    placementOverall: r.placementOverall != null ? String(r.placementOverall) : "",
    placementTotal: r.placementTotal != null ? String(r.placementTotal) : "",
    feltRating: r.feltRating != null ? String(r.feltRating) : "",
    notes: r.notes ?? "",
  };
}

export default function Races() {
  const { data: results, isLoading } = useListRaceResults();
  const [editing, setEditing] = useState<EditState | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const update = useUpdateRaceResult();
  const del = useDeleteRaceResult();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListRaceResultsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRaceWeekQueryKey() });
  };

  const handleSave = () => {
    if (!editing) return;
    const parseIntOrNull = (s: string): number | null => {
      const trimmed = s.trim();
      if (!trimmed) return null;
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1) return NaN as unknown as number;
      return n;
    };
    const placementOverall = parseIntOrNull(editing.placementOverall);
    const placementTotal = parseIntOrNull(editing.placementTotal);
    const feltRaw = editing.feltRating.trim();
    const feltRating = feltRaw ? Number(feltRaw) : null;

    if (Number.isNaN(placementOverall) || Number.isNaN(placementTotal)) {
      toast({ title: "Invalid placement", description: "Placements must be positive integers.", variant: "destructive" });
      return;
    }
    if (feltRating != null && (!Number.isInteger(feltRating) || feltRating < 1 || feltRating > 5)) {
      toast({ title: "Invalid felt rating", description: "Felt rating must be 1-5.", variant: "destructive" });
      return;
    }

    update.mutate(
      {
        raceDate: editing.raceDate,
        data: {
          finishTime: editing.finishTime.trim() || null,
          placementOverall,
          placementTotal,
          feltRating,
          notes: editing.notes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Race result updated" });
          setEditing(null);
          invalidate();
        },
        onError: () => {
          toast({ title: "Update failed", variant: "destructive" });
        },
      },
    );
  };

  const handleDelete = (raceDate: string) => {
    del.mutate(
      { raceDate },
      {
        onSuccess: () => {
          toast({ title: "Race result deleted" });
          invalidate();
        },
        onError: () => {
          toast({ title: "Delete failed", variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      <div>
        <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Race History</h2>
        <p className="text-muted-foreground uppercase font-medium tracking-widest mt-1">
          Every Finish Line, Every Campaign
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ) : !results || results.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Trophy className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="font-semibold uppercase tracking-wider">No race results logged yet</p>
            <p className="text-sm mt-2">
              Once you log a race-day result from the post-race banner, it will live here for good.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <Card key={r.raceDate} data-testid={`race-row-${r.raceDate}`}>
              <CardHeader className="pb-2">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <Trophy className="h-5 w-5 text-primary shrink-0" />
                    <CardTitle className="text-lg uppercase tracking-wider">
                      {formatDate(r.raceDate)}
                    </CardTitle>
                    {r.raceKind && (
                      <Badge variant="secondary" className="uppercase tracking-wider">
                        {RACE_KIND_LABELS[r.raceKind] ?? r.raceKind}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(toEditState(r))}
                      data-testid={`edit-race-${r.raceDate}`}
                    >
                      <Pencil className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          data-testid={`delete-race-${r.raceDate}`}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete race result?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes the {formatDate(r.raceDate)} finish from your history.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(r.raceDate)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Finish Time
                    </div>
                    <div className="font-mono font-bold text-primary text-lg mt-1">
                      {r.finishTime ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Placement
                    </div>
                    <div className="font-mono font-semibold mt-1">{placementText(r)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Felt
                    </div>
                    <div className="font-mono font-semibold mt-1">{feltLabel(r.feltRating)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Logged
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDate(r.recordedAt.slice(0, 10))}
                    </div>
                  </div>
                </div>
                {r.notes && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                      Notes
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{r.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit race result {editing && `· ${formatDate(editing.raceDate)}`}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="finishTime">Finish time</Label>
                <Input
                  id="finishTime"
                  placeholder="2:14:08"
                  value={editing.finishTime}
                  onChange={(e) => setEditing({ ...editing, finishTime: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="placementOverall">Placement</Label>
                  <Input
                    id="placementOverall"
                    inputMode="numeric"
                    placeholder="312"
                    value={editing.placementOverall}
                    onChange={(e) =>
                      setEditing({ ...editing, placementOverall: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="placementTotal">Field size</Label>
                  <Input
                    id="placementTotal"
                    inputMode="numeric"
                    placeholder="1804"
                    value={editing.placementTotal}
                    onChange={(e) =>
                      setEditing({ ...editing, placementTotal: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="feltRating">Felt rating (1-5)</Label>
                <Input
                  id="feltRating"
                  inputMode="numeric"
                  placeholder="4"
                  value={editing.feltRating}
                  onChange={(e) => setEditing({ ...editing, feltRating: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  rows={4}
                  value={editing.notes}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
