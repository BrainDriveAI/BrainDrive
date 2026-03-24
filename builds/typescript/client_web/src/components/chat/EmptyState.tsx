type ProjectIntro = {
  heading: string;
  description: string;
  suggestions: string[];
};

const PROJECT_INTROS: Record<string, ProjectIntro> = {
  "braindrive-plus-one": {
    heading: "What would you like to work on?",
    description:
      "Pick something on your mind right now — a goal, a problem, a decision — and let's make progress on it in the next five minutes.",
    suggestions: [
      "I want to get my finances in order but I don't know where to start",
      "I'm thinking about changing careers and need to figure out my next move",
      "My fitness has slipped and I want a realistic plan to get back on track",
      "Help me think through a tough conversation I need to have"
    ]
  },
  finance: {
    heading: "Your financial life, organized",
    description:
      "Whether you're budgeting, saving, investing, or just trying to understand where your money goes — everything we work on lives here.",
    suggestions: [
      "Help me build a budget based on my actual spending",
      "I want to save $10K in the next 12 months — what's the plan?",
      "Walk me through whether I should pay off debt or invest",
      "Update my income — I'm starting a new job at $85K"
    ]
  },
  fitness: {
    heading: "Your health and fitness goals",
    description:
      "I have context on everything we've discussed here — your history, your constraints, what's worked and what hasn't.",
    suggestions: [
      "Build me a 3-day-a-week workout I can do at a gym",
      "I've been eating terribly — help me plan meals for the week",
      "I want to run a half marathon in six months. Am I crazy?",
      "Update my plan — I tweaked my knee and can't do squats for a few weeks"
    ]
  },
  career: {
    heading: "Your career strategy",
    description:
      "Job search, skill development, salary negotiation, long-term planning — whatever you're navigating, we'll work through it together.",
    suggestions: [
      "I have an interview Thursday — help me prepare",
      "Review my resume and tell me what's weak",
      "I'm torn between two job offers — help me think through the tradeoffs",
      "I want to move into management in the next two years. What should I be doing now?"
    ]
  },
  relationships: {
    heading: "The people in your life matter",
    description:
      "This is where we work on communication, navigate tough situations, and make sure you're investing in the relationships that matter most.",
    suggestions: [
      "I need to have a hard conversation with my partner about money",
      "Help me plan something meaningful for my dad's birthday",
      "I've been neglecting friendships — help me build a plan to reconnect",
      "My team at work has a conflict I need to mediate. Walk me through it."
    ]
  },
  "new-project": {
    heading: "A blank canvas",
    description:
      "Tell me what you're working on and we'll build it out together — goals, a plan, whatever structure helps you make progress.",
    suggestions: [
      "I'm planning a kitchen renovation and need to organize everything",
      "I want to write a book — help me figure out the scope",
      "I'm starting a side business and need to think through the first steps",
      "Help me plan a two-week trip to Japan"
    ]
  }
};

const DEFAULT_INTRO: ProjectIntro = {
  heading: "What would you like to work on?",
  description:
    "Your BrainDrive remembers everything — conversations, decisions, and context compound over time.",
  suggestions: [
    "Get to know your BrainDrive",
    "Help me plan my week",
    "Review my career goals",
    "Process a meeting transcript"
  ]
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
    </div>
  );
}
