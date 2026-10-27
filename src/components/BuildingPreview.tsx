import { Button } from "@/components/ui/Button";
import type { PreviewConversation } from "@/components/AssistantPanel";
import "./BuildingPreview.css";

const steps = [
  "Understanding your idea",
  "Designing layout and typography",
  "Writing the content",
  "Putting the pages together",
];

export function BuildingPreview({
  conversation,
  assembling,
  failed,
}: {
  conversation: PreviewConversation;
  assembling: boolean;
  failed: boolean;
}) {
  // The stream exposes text deltas, not named design stages. Only assembly
  // is confirmed by receiving project files; no step implies 100% completion.
  const currentStep = assembling ? 3 : conversation.responseLength > 600 ? 2 : conversation.responseLength > 0 ? 1 : 0;
  return (
    <div className="building-view">
      <div className="building-content">
        <p className="font-mono text-[10px] uppercase tracking-[.2em] text-accent">Building your site</p>
        <h2 className="mt-3 font-display text-2xl font-semibold">Bringing your idea to life</h2>
        <blockquote className="building-prompt" title={conversation.prompt}>
          <p>{`\u201c${conversation.prompt}\u201d`}</p>
        </blockquote>
        {failed ? (
          <div role="alert" className="space-y-4 text-sm">
            <p>Something went wrong while building. Try again</p>
            <Button disabled={conversation.retryDisabled} onClick={conversation.retry} variant="primary">Retry</Button>
          </div>
        ) : (
          <>
            <ol aria-label="Build progress" aria-live="polite" className="building-steps">
              {steps.map((step, index) => (
                <li aria-current={index === currentStep ? "step" : undefined} className={index === currentStep ? "is-current" : ""} key={step}>
                  <span aria-hidden="true" className={index === currentStep ? "building-dot" : ""}>
                    {index < currentStep ? "\u2713" : index === currentStep ? "\u25cf" : "\u25cb"}
                  </span>
                  <span className="sr-only">{index < currentStep ? "Complete: " : index === currentStep ? "Current: " : "Pending: "}</span>
                  {step}
                </li>
              ))}
            </ol>
            <div aria-hidden="true" className="building-skeleton">
              <div className="skeleton-nav"><i /><span /><span /><span /></div>
              <div className="skeleton-hero"><i /><i /><span /></div>
              <div className="skeleton-cards"><i /><i /><i /></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
