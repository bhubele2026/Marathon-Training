import { useState } from "react";
import {
  useListRaceResults,
  useUpdateRaceResult,
  useDeleteRaceResult,
  useUpsertRaceResult,
  useListScheduledRaces,
  useCreateScheduledRace,
  useUpdateScheduledRace,
  useDeleteScheduledRace,
  getListRaceResultsQueryKey,
  getListScheduledRacesQueryKey,
  getGetRaceWeekQueryKey,
  getGetPlanOverviewQueryKey,
  getListPlanWeeksQueryKey,
  getGetTodayPlanQueryKey,
  type RaceResult,
  type ScheduledRace,
  CreateScheduledRaceBodyRaceKind,
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
import { Trophy, Pencil, Trash2, Plus, CalendarDays, ClipboardCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface ScheduleDraft {
  raceDate: string;
  raceKind: keyof typeof CreateScheduledRaceBodyRaceKind;
  name: string;
  notes: string;
  // When set, the dialog is editing an existing scheduled race
  // (PATCH) rather than creating a new one (POST). The original
  // `raceDate` is captured here so PATCH always targets the row that
  // was being edited even if the runner re-types the date input.
  editOriginalDate?: string;
}

const EMPTY_SCHEDULE_DRAFT: ScheduleDraft = {
  raceDate: "",
  raceKind: "5k",
  name: "",
  notes: "",
};

interface LogResultDraft {
  raceDate: string;
  raceKind: keyof typeof CreateScheduledRaceBodyRaceKind;
  name: string | null | undefined;
  finishTime: string;
  placementOverall: string;
  placementTotal: string;
  feltRating: string;
  notes: string;
}

export default function Races() {
  const { data: results, isLoading } = useListRaceResults();
  const { data: scheduled, isLoading: schedLoading } = useListScheduledRaces();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [logDraft, setLogDraft] = useState<LogResultDraft | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const update = useUpdateRaceResult();
  const del = useDeleteRaceResult();
  const upsertResult = useUpsertRaceResult();
  const createScheduled = useCreateScheduledRace();
  const updateScheduled = useUpdateScheduledRace();
  const deleteScheduled = useDeleteScheduledRace();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListRaceResultsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRaceWeekQueryKey() });
  };

  const invalidateScheduled = () => {
    queryClient.invalidateQueries({ queryKey: getListScheduledRacesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPlanOverviewQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPlanWeeksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayPlanQueryKey() });
    // Invalidate every per-week detail key (prefix match) so any
    // currently-mounted /plan/:week page picks up the new chip.
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/plan/weeks/"),
    });
  };

  const handleAddScheduled = () => {
    if (!scheduleDraft) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDraft.raceDate)) {
      toast({ title: "Pick a valid date", variant: "destructive" });
      return;
    }
    if (scheduleDraft.editOriginalDate) {
      // PATCH path. The schema doesn't currently allow changing the
      // primary-key date (raceDate is the PK), so the date input is
      // disabled in the dialog and we only patch the mutable fields.
      updateScheduled.mutate(
        {
          raceDate: scheduleDraft.editOriginalDate,
          data: {
            raceKind: scheduleDraft.raceKind,
            name: scheduleDraft.name.trim() || null,
            notes: scheduleDraft.notes.trim() || null,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Scheduled race updated" });
            setScheduleDraft(null);
            invalidateScheduled();
          },
          onError: () => {
            toast({ title: "Could not update race", variant: "destructive" });
          },
        },
      );
      return;
    }
    createScheduled.mutate(
      {
        data: {
          raceDate: scheduleDraft.raceDate,
          raceKind: scheduleDraft.raceKind,
          name: scheduleDraft.name.trim() || null,
          notes: scheduleDraft.notes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Race scheduled" });
          setScheduleDraft(null);
          invalidateScheduled();
        },
        onError: (err: unknown) => {
          const status =
            (err as { response?: { status?: number } } | undefined)?.response
              ?.status ?? 0;
          toast({
            title:
              status === 409
                ? "A race is already scheduled on that date"
                : "Could not schedule race",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleLogResult = () => {
    if (!logDraft) return;
    const parseIntOrInvalid = (s: string): number | null | "invalid" => {
      const trimmed = s.trim();
      if (!trimmed) return null;
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1) return "invalid";
      return n;
    };
    const overall = parseIntOrInvalid(logDraft.placementOverall);
    const total = parseIntOrInvalid(logDraft.placementTotal);
    if (overall === "invalid" || total === "invalid") {
      toast({
        title: "Invalid placement",
        description: "Placements must be positive integers.",
        variant: "destructive",
      });
      return;
    }
    const feltRaw = logDraft.feltRating.trim();
    const feltRating = feltRaw ? Number(feltRaw) : null;
    if (
      feltRating != null &&
      (!Number.isInteger(feltRating) || feltRating < 1 || feltRating > 5)
    ) {
      toast({
        title: "Invalid felt rating",
        description: "Felt rating must be 1-5.",
        variant: "destructive",
      });
      return;
    }
    upsertResult.mutate(
      {
        raceDate: logDraft.raceDate,
        data: {
          finishTime: logDraft.finishTime.trim() || null,
          placementOverall: overall,
          placementTotal: total,
          feltRating,
          notes: logDraft.notes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Race result saved" });
          setLogDraft(null);
          invalidate();
          invalidateScheduled();
        },
        onError: () => {
          toast({ title: "Could not save result", variant: "destructive" });
        },
      },
    );
  };

  const handleDeleteScheduled = (raceDate: string) => {
    deleteScheduled.mutate(
      { raceDate },
      {
        onSuccess: () => {
          toast({ title: "Scheduled race removed" });
          invalidateScheduled();
        },
        onError: () => {
          toast({ title: "Delete failed", variant: "destructive" });
        },
      },
    );
  };

  const todayISO = new Date().toISOString().slice(0, 10);
  const upcoming = (scheduled ?? []).filter((s) => s.raceDate >= todayISO);
  const pastUnlogged = (scheduled ?? []).filter(
    (s) => s.raceDate < todayISO && !s.hasResult,
  );

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
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Race History</h2>
          <p className="text-muted-foreground uppercase font-medium tracking-widest mt-1">
            Every Finish Line, Every Campaign
          </p>
        </div>
        <Button
          onClick={() => setScheduleDraft({ ...EMPTY_SCHEDULE_DRAFT })}
          data-testid="button-schedule-race"
        >
          <Plus className="h-4 w-4 mr-1" /> Schedule Race
        </Button>
      </div>

      <Card data-testid="card-upcoming-races">
        <CardHeader className="pb-2">
          <CardTitle className="text-base uppercase tracking-wider flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            Upcoming Races
          </CardTitle>
        </CardHeader>
        <CardContent>
          {schedLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : upcoming.length === 0 && pastUnlogged.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No races on the calendar. Use Schedule Race to add a 5K, 10K, half, or marathon.
            </p>
          ) : (
            <div className="space-y-2">
              {[...upcoming, ...pastUnlogged].map((sr: ScheduledRace) => {
                const isPast = sr.raceDate < todayISO;
                return (
                  <div
                    key={sr.raceDate}
                    className="flex items-center justify-between gap-3 p-3 rounded border border-border"
                    data-testid={`scheduled-race-${sr.raceDate}`}
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge variant="secondary" className="uppercase tracking-wider">
                        {RACE_KIND_LABELS[sr.raceKind] ?? sr.raceKind}
                      </Badge>
                      <span className="font-mono font-bold text-primary">
                        {formatDate(sr.raceDate)}
                      </span>
                      {sr.name && (
                        <span className="text-sm text-muted-foreground">{sr.name}</span>
                      )}
                      {isPast && !sr.hasResult && (
                        <Badge variant="destructive" className="uppercase tracking-wider">
                          Result Pending
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {isPast && !sr.hasResult && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() =>
                            setLogDraft({
                              raceDate: sr.raceDate,
                              raceKind:
                                sr.raceKind as LogResultDraft["raceKind"],
                              name: sr.name,
                              finishTime: "",
                              placementOverall: "",
                              placementTotal: "",
                              feltRating: "",
                              notes: "",
                            })
                          }
                          data-testid={`log-result-${sr.raceDate}`}
                        >
                          <ClipboardCheck className="h-4 w-4 mr-1" />
                          Log result
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setScheduleDraft({
                            raceDate: sr.raceDate,
                            raceKind:
                              sr.raceKind as ScheduleDraft["raceKind"],
                            name: sr.name ?? "",
                            notes: sr.notes ?? "",
                            editOriginalDate: sr.raceDate,
                          })
                        }
                        data-testid={`edit-scheduled-${sr.raceDate}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            data-testid={`delete-scheduled-${sr.raceDate}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove scheduled race?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the {formatDate(sr.raceDate)} entry from your race calendar. Logged results are not affected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteScheduled(sr.raceDate)}>
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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

      <Dialog
        open={scheduleDraft != null}
        onOpenChange={(o) => !o && setScheduleDraft(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {scheduleDraft?.editOriginalDate ? "Edit scheduled race" : "Schedule a race"}
            </DialogTitle>
          </DialogHeader>
          {scheduleDraft && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="schedRaceDate">Race date</Label>
                <Input
                  id="schedRaceDate"
                  type="date"
                  value={scheduleDraft.raceDate}
                  onChange={(e) =>
                    setScheduleDraft({ ...scheduleDraft, raceDate: e.target.value })
                  }
                  disabled={!!scheduleDraft.editOriginalDate}
                  data-testid="input-scheduled-race-date"
                />
              </div>
              <div>
                <Label htmlFor="schedRaceKind">Distance</Label>
                <Select
                  value={scheduleDraft.raceKind}
                  onValueChange={(v) =>
                    setScheduleDraft({
                      ...scheduleDraft,
                      raceKind: v as ScheduleDraft["raceKind"],
                    })
                  }
                >
                  <SelectTrigger id="schedRaceKind" data-testid="select-scheduled-race-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5k">5K</SelectItem>
                    <SelectItem value="10k">10K</SelectItem>
                    <SelectItem value="half">Half Marathon</SelectItem>
                    <SelectItem value="marathon">Marathon</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="schedName">Name (optional)</Label>
                <Input
                  id="schedName"
                  placeholder="Brooklyn Mile 5K"
                  value={scheduleDraft.name}
                  onChange={(e) =>
                    setScheduleDraft({ ...scheduleDraft, name: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="schedNotes">Notes (optional)</Label>
                <Textarea
                  id="schedNotes"
                  rows={3}
                  value={scheduleDraft.notes}
                  onChange={(e) =>
                    setScheduleDraft({ ...scheduleDraft, notes: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddScheduled}
              disabled={createScheduled.isPending || updateScheduled.isPending}
              data-testid="button-confirm-schedule-race"
            >
              {createScheduled.isPending || updateScheduled.isPending
                ? "Saving…"
                : scheduleDraft?.editOriginalDate
                  ? "Save"
                  : "Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={logDraft != null}
        onOpenChange={(o) => !o && setLogDraft(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log race result</DialogTitle>
          </DialogHeader>
          {logDraft && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="uppercase tracking-wider">
                  {RACE_KIND_LABELS[logDraft.raceKind] ?? logDraft.raceKind}
                </Badge>
                <span className="font-mono font-bold text-primary">
                  {formatDate(logDraft.raceDate)}
                </span>
                {logDraft.name && (
                  <span className="text-sm text-muted-foreground">{logDraft.name}</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="logFinish">Finish time</Label>
                  <Input
                    id="logFinish"
                    placeholder="2:14:08"
                    value={logDraft.finishTime}
                    onChange={(e) =>
                      setLogDraft({ ...logDraft, finishTime: e.target.value })
                    }
                    data-testid="input-log-finish-time"
                  />
                </div>
                <div>
                  <Label htmlFor="logOverall">Placement</Label>
                  <Input
                    id="logOverall"
                    inputMode="numeric"
                    placeholder="312"
                    value={logDraft.placementOverall}
                    onChange={(e) =>
                      setLogDraft({ ...logDraft, placementOverall: e.target.value })
                    }
                    data-testid="input-log-placement-overall"
                  />
                </div>
                <div>
                  <Label htmlFor="logTotal">Field size</Label>
                  <Input
                    id="logTotal"
                    inputMode="numeric"
                    placeholder="1804"
                    value={logDraft.placementTotal}
                    onChange={(e) =>
                      setLogDraft({ ...logDraft, placementTotal: e.target.value })
                    }
                    data-testid="input-log-placement-total"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="logFelt">Felt rating (1-5)</Label>
                <Input
                  id="logFelt"
                  inputMode="numeric"
                  placeholder="4"
                  value={logDraft.feltRating}
                  onChange={(e) =>
                    setLogDraft({ ...logDraft, feltRating: e.target.value })
                  }
                  data-testid="input-log-felt-rating"
                />
              </div>
              <div>
                <Label htmlFor="logNotes">Notes</Label>
                <Textarea
                  id="logNotes"
                  rows={3}
                  placeholder="Splits, weather, fueling, what worked, what didn't..."
                  value={logDraft.notes}
                  onChange={(e) =>
                    setLogDraft({ ...logDraft, notes: e.target.value })
                  }
                  data-testid="input-log-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLogDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleLogResult}
              disabled={upsertResult.isPending}
              data-testid="button-confirm-log-result"
            >
              {upsertResult.isPending ? "Saving…" : "Save result"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
