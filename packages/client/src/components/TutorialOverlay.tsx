import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { TutorialStep } from "@dominion/shared";
import { api, ApiError } from "../api/client.js";
import { useGameState, useMyCompanies, useTutorial } from "../api/hooks.js";

// The presentational-only pause after the (already-instant) hire call — long
// enough to read "Hiring..." as a real event, not a backend delay mechanic
// that would change hiring pacing for every player, tutorial or not.
const HIRE_ANIMATION_MS = 2200;

interface StepContent {
  title: string;
  body: string;
  // Priority-ordered — the first selector that matches a mounted element
  // wins. Lets a step spotlight a NavBar link on pages where the real
  // target isn't mounted yet, then shift to the real target the moment the
  // player navigates to the page that has it.
  spotlightSelectors?: string[];
}

const STEP_CONTENT: Record<Exclude<TutorialStep, "completed">, StepContent> = {
  found_company: {
    title: "Found your first company",
    body: "Every settlement needs an economy. Head to the Companies tab and found a Construction company below — it's what will build zones for other industries.",
    spotlightSelectors: ['[data-tutorial="tutorial-found-company-submit"]'],
  },
  hiring: {
    title: "Hire your first workers",
    body: "Your company is founded but empty-handed. Hire workers to get it producing.",
  },
  government_unlock: {
    title: "Commission your first zone",
    body: "Head to Government and commission your first Industrial Zone with your construction company — that opens up room for more companies to be founded.",
    spotlightSelectors: ['[data-tutorial="tutorial-zone-form"]', '[data-tutorial="tutorial-nav-government"]'],
  },
  // Reached only for the instant between a successful commission and the
  // client's follow-up advance call landing — never rendered long enough
  // for its own spotlight to matter, but content is here in case that
  // timing ever changes.
  commission_zone: {
    title: "Zone commissioned",
    body: "Your zone is under construction.",
  },
};

// Recomputed on a short interval rather than via MutationObserver — the
// tutorial's targets move for reasons a resize/scroll listener alone won't
// catch (route changes, tab switches, data finishing a fetch), and a cheap
// poll while the overlay is mounted is simpler than wiring a mutation
// observer through every page that might host a spotlight target.
// STEP_CONTENT is a module-level constant, so `selectors` is the same array
// reference on every render for a given step — safe as a direct effect dep.
function useSpotlightRect(selectors: string[] | undefined) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!selectors || selectors.length === 0) {
      setRect(null);
      return;
    }
    const update = () => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          setRect(el.getBoundingClientRect());
          return;
        }
      }
      setRect(null);
    };
    update();
    const interval = setInterval(update, 400);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [selectors]);

  return rect;
}

export default function TutorialOverlay() {
  const queryClient = useQueryClient();
  const { data: tutorial } = useTutorial();
  const { data: mine } = useMyCompanies();
  const { data: gameState } = useGameState();
  const [hiring, setHiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = tutorial?.step;
  const invalidateTutorial = () => queryClient.invalidateQueries({ queryKey: ["tutorial"] });

  const advance = useMutation({
    mutationFn: (s: TutorialStep) => api.tutorialAdvance(s),
    onSuccess: invalidateTutorial,
  });

  const skip = useMutation({
    mutationFn: () => api.tutorialSkip(),
    onSuccess: invalidateTutorial,
  });

  // The tutorial's own construction company, rediscovered from data rather
  // than remembered in local state — so a mid-tutorial page refresh doesn't
  // strand the player without a target for the hire button.
  const hireCompany = (mine?.companies ?? []).find(
    (c) => c.industry === "construction" && c.controlledByMe && c.workersAssigned === 0,
  );

  const hireWorkers = useMutation({
    mutationFn: () => {
      if (!hireCompany) throw new Error("No company to hire for");
      const available = gameState?.population.available ?? 0;
      const target = Math.min(hireCompany.maxWorkers, Math.max(1, available));
      return api.setCompanyWorkers(hireCompany.id, target);
    },
    onSuccess: () => {
      setError(null);
      setHiring(true);
      queryClient.invalidateQueries({ queryKey: ["myCompanies"] });
      queryClient.invalidateQueries({ queryKey: ["gameState"] });
      setTimeout(() => {
        setHiring(false);
        advance.mutate("hiring");
      }, HIRE_ANIMATION_MS);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't hire workers"),
  });

  const content = step && step !== "completed" ? STEP_CONTENT[step] : null;
  const rect = useSpotlightRect(content?.spotlightSelectors);

  if (!step || step === "completed" || !content) return null;

  return (
    <>
      {rect && (
        <div
          className="tutorial-spotlight"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div className="tutorial-panel">
        <div className="tutorial-panel__title">{content.title}</div>
        <p className="tutorial-panel__body">{content.body}</p>
        {error && <div className="auth-error">{error}</div>}
        {step === "hiring" &&
          // `hiring` takes precedence over `hireCompany` — the hire mutation's
          // success handler invalidates myCompanies right away, so partway
          // through the animation hireCompany briefly stops matching (it's
          // filtered on workersAssigned === 0, which just became false).
          // Without this ordering the button would flicker to the "still
          // looking" fallback mid-animation even though hiring is underway.
          (hiring ? (
            <button className="btn btn--accent" disabled>
              Hiring...
            </button>
          ) : hireCompany ? (
            <button className="btn btn--accent" disabled={hireWorkers.isPending} onClick={() => hireWorkers.mutate()}>
              Hire Workers
            </button>
          ) : (
            <p className="suggestion">Looking for your construction company...</p>
          ))}
        {hiring && (
          <div className="tutorial-progress">
            <div className="tutorial-progress__fill" />
          </div>
        )}
        <button className="tutorial-panel__skip" onClick={() => skip.mutate()}>
          Skip tutorial
        </button>
      </div>
    </>
  );
}
