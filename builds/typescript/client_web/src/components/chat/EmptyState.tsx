type ProjectIntro = {
  heading: string;
  description: string;
  cta?: string;
  suggestions?: string[];
};

const PROJECT_INTROS: Record<string, ProjectIntro> = {
  "braindrive-plus-one": {
    heading: "Welcome to BrainDrive",
    description:
      "Pick something on your mind right now — a goal, a problem, a decision — and let's make progress on it in the next five minutes.",
    suggestions: [
      "I want to get my finances in order",
      "I'm thinking about changing careers",
      "My fitness has slipped and I want a plan",
      "Help me think through a tough conversation"
    ]
  },
  finance: {
    heading: "Let's get your finances organized",
    description:
      "We'll spend about 5 minutes figuring out where you are and where you want to be. Then we'll build a spec and action plan together.",
    cta: "Let's get started"
  },
  fitness: {
    heading: "Let's build a plan for your health",
    description:
      "We'll spend about 5 minutes talking through your situation and goals. Then we'll put together a spec and action plan.",
    cta: "Let's get started"
  },
  career: {
    heading: "Let's map out your career",
    description:
      "We'll spend about 5 minutes on what's happening and what you're aiming for. Then we'll build a strategy together.",
    cta: "Let's get started"
  },
  relationships: {
    heading: "Let's invest in the people who matter",
    description:
      "We'll spend about 5 minutes on what's on your mind. Then we'll put together a plan to make progress.",
    cta: "Let's get started"
  },
  "new-project": {
    heading: "What are you working on?",
    description:
      "Tell me what this is about. We'll spend a few minutes getting clear on the goal, then build a spec and plan together.",
    cta: "Let's figure it out"
  }
};

const DEFAULT_INTRO: ProjectIntro = {
  heading: "What would you like to work on?",
  description:
    "Tell me what's on your mind and I'll help you make progress.",
  cta: "Let's get started"
};

type EmptyStateProps = {
  projectId?: string | null;
  onSuggestionClick?: (suggestion: string) => void;
};

export default function EmptyState({ projectId, onSuggestionClick }: EmptyStateProps) {
  const intro = (projectId && PROJECT_INTROS[projectId]) || DEFAULT_INTRO;

  return (
    <div
      className="flex flex-col items-center justify-center overflow-y-auto px-6 pb-[calc(var(--mobile-composer-height,0px)+4rem)] md:pb-16"
      style={{ height: '100%', WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
    >
      <img
        src="/braindrive-logo.svg"
        alt="BrainDrive"
        className="mb-6 h-10 w-auto opacity-40"
      />

      <h2 className="text-center font-heading text-lg font-medium text-bd-text-heading">
        {intro.heading}
      </h2>

      <p className="mt-2 max-w-[400px] text-center text-sm text-bd-text-muted">
        {intro.description}
      </p>

      {intro.suggestions ? (
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {intro.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestionClick?.(suggestion)}
              className="rounded-xl border border-bd-border bg-bd-bg-secondary px-4 py-2.5 text-sm text-bd-text-secondary transition-all duration-200 hover:border-bd-amber/40 hover:bg-bd-bg-tertiary"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : intro.cta ? (
        <button
          type="button"
          onClick={() => onSuggestionClick?.(intro.cta!)}
          className="mt-8 rounded-xl bg-bd-amber px-6 py-3 text-sm font-medium text-bd-bg-primary transition-colors duration-200 hover:bg-bd-amber-hover"
        >
          {intro.cta}
        </button>
      ) : null}
    </div>
  );
}
