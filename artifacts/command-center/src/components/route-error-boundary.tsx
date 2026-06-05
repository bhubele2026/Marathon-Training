import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Final safety net so a render-time error in a route never collapses the
// whole app to a blank page. Chunk-load failures are already auto-recovered
// by `lazyWithReload`; this catches any other unexpected render error and
// offers a manual reload instead of an empty screen.
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Route render error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">
            Something went wrong loading this page
          </h2>
          <p className="text-sm text-muted-foreground">
            A new version may have just been published. Reload to get the
            latest.
          </p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
