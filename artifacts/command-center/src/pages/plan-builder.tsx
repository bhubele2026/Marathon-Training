import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Loader2, Check, AlertTriangle, Info, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Local copies of the plan shapes returned by /api/plan-builder. Kept inline so
// the training-science briefing in @workspace/plan-knowledge never ships to the
// browser bundle. Mirror lib/plan-knowledge/src/types.ts + materialize.ts.
// ---------------------------------------------------------------------------
type RaceKind = "marathon" | "half" | "10k" | "5k" | "none";

interface AiDay {
  day: string;
  isRest: boolean;
  sessionType: string;
  strengthMin: number;
  cardioMin: number;
  runMin: number;
  distanceMi?: number | null;
  pace?: string | null;
  equipmentList: string[];
  description: string;
}
interface AiWeek {
  week: number;
  phase: string;
  days: AiDay[];
}
type GoalKind = "recomp" | "strength" | "hypertrophy" | "fat_loss" | "general" | "race";
interface AiPlan {
  summary: string;
  name: string;
  goalKind?: GoalKind | null;
  raceKind?: RaceKind | null;
  /** Set when the coach anchored the plan to a real Tonal program. */
  tonalProgram?: string | null;
  startDate: string;
  weeks: AiWeek[];
}
interface WeeklyPreview {
  week: number;
  phase: string;
  startDate: string;
  endDate: string;
  plannedMiles: number;
  longRunMi: number;
}
interface Guardrail {
  level: "warn" | "info";
  code: string;
  message: string;
  week?: number;
  day?: string;
}
type ChatMsg = { role: "user" | "assistant"; content: string };

interface PlanEvent {
  type: "plan";
  plan: AiPlan;
  guardrails: Guardrail[];
  weekly: WeeklyPreview[];
  marathonDate: string | null;
  totalWeeks: number;
}
type StreamEvent =
  | { type: "text"; text: string }
  | PlanEvent
  | { type: "done" }
  | { type: "error"; message: string };

const SUGGESTIONS = [
  "12 weeks, mostly lifting with 2 short runs a week, build to a 10K.",
  "Half-marathon in 16 weeks. Keep my 6 Tonal days. Long runs on Sunday.",
  "8-week strength block, no running, focus on losing weight.",
];

export default function PlanBuilder() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  // Optional timeframe: a target date ("2026-10-01") OR a free-text length
  // ("12 weeks"). Woven into the FIRST message so Claude maps it to totalWeeks
  // / an end date. Cleared after it's been folded into a turn.
  const [timeframe, setTimeframe] = useState("");

  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [weekly, setWeekly] = useState<WeeklyPreview[]>([]);
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [totalWeeks, setTotalWeeks] = useState<number>(0);
  const [planName, setPlanName] = useState<string>("");
  const [accepting, setAccepting] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    // Fold the timeframe into the FIRST user message only (when the chat is
    // empty). A bare date is read as a target date; anything else as a length.
    let content = trimmed;
    const tf = timeframe.trim();
    if (tf && messages.length === 0) {
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(tf);
      content += isDate
        ? `\n\nTimeframe: get me to my goal by ${tf} (target date — build the right number of weeks to land there).`
        : `\n\nTimeframe: ${tf}.`;
      setTimeframe("");
    }

    const nextMessages: ChatMsg[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setStreaming("");
    setBusy(true);
    scrollToBottom();

    try {
      const resp = await fetch("/api/plan-builder/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, currentPlan: plan ?? undefined }),
      });

      if (!resp.ok || !resp.body) {
        let msg = `Request failed (${resp.status}).`;
        try {
          const j = await resp.json();
          if (j?.error) msg = j.error;
        } catch {
          /* non-JSON error body */
        }
        toast({ title: "Plan builder error", description: msg, variant: "destructive" });
        setBusy(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";

      // Read the SSE stream frame-by-frame (frames separated by a blank line).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
          if (!line.trim()) continue;
          let evt: StreamEvent;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (evt.type === "text") {
            assistantText += evt.text;
            setStreaming(assistantText);
            scrollToBottom();
          } else if (evt.type === "plan") {
            setPlan(evt.plan);
            setWeekly(evt.weekly);
            setGuardrails(evt.guardrails);
            setTotalWeeks(evt.totalWeeks);
            setPlanName((prev) => prev || evt.plan.name);
          } else if (evt.type === "error") {
            toast({
              title: "Plan builder error",
              description: evt.message,
              variant: "destructive",
            });
          }
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: assistantText || "(proposed an updated plan — see the preview)",
        },
      ]);
      setStreaming("");
    } catch (err) {
      toast({
        title: "Plan builder error",
        description: err instanceof Error ? err.message : "Network error.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }

  // Adjust-from-anywhere: when the builder is opened with a `?seed=...` query
  // param (from the Today view or a day card — e.g. "Make Wednesday shorter"),
  // pre-fill the input with that message so the runner sees it and can send /
  // edit it. Runs once on mount; we strip the param so a refresh doesn't replay
  // it. The existing propose_plan revise flow then handles it like any turn.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const seed = params.get("seed");
    if (seed && seed.trim()) {
      setInput(seed.trim());
      // Drop the query param without reloading so a manual refresh starts clean.
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function accept() {
    if (!plan || accepting) return;
    setAccepting(true);
    try {
      const resp = await fetch("/api/plan-builder/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan, name: planName || plan.name }),
      });
      if (!resp.ok) {
        let msg = `Accept failed (${resp.status}).`;
        try {
          const j = await resp.json();
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        toast({ title: "Couldn't apply plan", description: msg, variant: "destructive" });
        return;
      }
      const data = await resp.json();
      await queryClient.invalidateQueries();
      toast({
        title: "Plan applied",
        description: `${data.weeksSeeded} weeks · ${data.daysSeeded} days seeded.`,
      });
      navigate("/plan");
    } catch (err) {
      toast({
        title: "Couldn't apply plan",
        description: err instanceof Error ? err.message : "Network error.",
        variant: "destructive",
      });
    } finally {
      setAccepting(false);
    }
  }

  const maxMiles = Math.max(1, ...weekly.map((w) => w.plannedMiles));
  const warnings = guardrails.filter((g) => g.level === "warn");
  const infos = guardrails.filter((g) => g.level === "info");

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-primary">Build with Claude</h1>
          <p className="text-sm text-muted-foreground">
            Describe the plan you want. Go back and forth. Accept when you like it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("/planner/manual")}
          data-testid="open-manual-planner"
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Advanced editor
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Chat */}
        <Card className="flex h-[70vh] flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversation</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {messages.length === 0 && !streaming && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Try one of these:</p>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="block w-full rounded-md border border-border bg-muted/40 p-2 text-left text-sm hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-md p-2 text-sm",
                    m.role === "user"
                      ? "ml-8 bg-primary/10 text-foreground"
                      : "mr-8 bg-muted/50 text-foreground",
                  )}
                >
                  <div className="mb-1 text-xs tracking-wider text-muted-foreground">
                    {m.role === "user" ? "You" : "Claude"}
                  </div>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              ))}
              {streaming && (
                <div className="mr-8 rounded-md bg-muted/50 p-2 text-sm">
                  <div className="mb-1 text-xs tracking-wider text-muted-foreground">
                    Claude
                  </div>
                  <div className="whitespace-pre-wrap">{streaming}</div>
                </div>
              )}
              {busy && !streaming && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              )}
            </div>

            {/* Optional timeframe — a target date or a length. Only meaningful
                on the first message; once the conversation is going, the
                timeframe lives in the chat. */}
            {messages.length === 0 && (
              <div className="space-y-1">
                <label
                  htmlFor="plan-builder-timeframe"
                  className="text-xs text-muted-foreground"
                >
                  Target date or length (optional)
                </label>
                <Input
                  id="plan-builder-timeframe"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  placeholder='e.g. "2026-10-01" or "12 weeks"'
                  disabled={busy}
                  data-testid="plan-builder-timeframe"
                />
              </div>
            )}

            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={busy ? "Waiting for Claude…" : "Tell Claude what you want…"}
                disabled={busy}
                data-testid="plan-builder-input"
              />
              <Button type="submit" disabled={busy || !input.trim()} data-testid="plan-builder-send">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card className="flex h-[70vh] flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Proposed plan</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            {!plan ? (
              <p className="text-sm text-muted-foreground">
                No plan yet. Once Claude proposes one, it shows up here with a weekly
                preview and an Accept button.
              </p>
            ) : (
              <>
                <p className="text-sm">{plan.summary}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">{totalWeeks} weeks</Badge>
                  <Badge variant="secondary">
                    {plan.raceKind && plan.raceKind !== "none"
                      ? plan.raceKind.toUpperCase()
                      : plan.goalKind
                        ? plan.goalKind.replace("_", " ")
                        : "Workout plan"}
                  </Badge>
                  <Badge variant="secondary">Starts {plan.startDate}</Badge>
                </div>

                {/* Phase 2: Tonal-program anchoring honesty note. Structure is
                    replicated — there is no Tonal account connection / live
                    import (Tonal has no public API). */}
                {plan.tonalProgram && (
                  <p className="text-xs text-muted-foreground">
                    Built around the structure of{" "}
                    <span className="font-medium text-foreground">{plan.tonalProgram}</span>.
                    Studio replicates the program's structure (split, progression,
                    movement focus) and schedules around it — it doesn't connect to
                    your Tonal account or import your live program. Run the official
                    program in the Tonal app for the in-app coaching.
                  </p>
                )}

                {(warnings.length > 0 || infos.length > 0) && (
                  <div className="space-y-1">
                    {warnings.map((g, i) => (
                      <div key={`w${i}`} className="flex items-start gap-2 text-xs text-amber-500">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{g.message}</span>
                      </div>
                    ))}
                    {infos.map((g, i) => (
                      <div
                        key={`i${i}`}
                        className="flex items-start gap-2 text-xs text-muted-foreground"
                      >
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{g.message}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                  <div className="flex items-center gap-2 text-[10px] tracking-wider text-muted-foreground">
                    <span className="w-10 shrink-0">Week</span>
                    <span className="w-28 shrink-0">Phase</span>
                    <span className="flex-1">Running volume (all runs, per week)</span>
                    <span className="w-24 shrink-0 text-right">wk / longest</span>
                  </div>
                  {weekly.map((w) => (
                    <div key={w.week} className="flex items-center gap-2 text-xs">
                      <span className="w-10 shrink-0 text-muted-foreground">W{w.week}</span>
                      <span className="w-28 shrink-0 truncate">{w.phase}</span>
                      <div className="h-2 flex-1 rounded bg-muted">
                        <div
                          className="h-2 rounded bg-primary"
                          style={{ width: `${(w.plannedMiles / maxMiles) * 100}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right font-mono">
                        {w.plannedMiles.toFixed(1)}/{w.longRunMi.toFixed(0)} mi
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <Input
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    placeholder="Plan name"
                    className="flex-1"
                    data-testid="plan-builder-name"
                  />
                  <Button onClick={accept} disabled={accepting} data-testid="plan-builder-accept">
                    {accepting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Accept &amp; apply
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
