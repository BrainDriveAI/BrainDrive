# BrainDrive Roadmap

> Where we've been, where we are, and where we're going.

BrainDrive is built in five phases. Each phase makes your AI system more capable. BrainDrive is an early reference implementation and participant in a wider ecosystem where independently built Personal AI systems can interoperate without becoming one company's platform. At scale, something bigger emerges — when millions of owner-controlled AI systems connect, the sum becomes greater than the parts.

Built on the [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) — an open, MIT-licensed foundation for building personal AI systems with zero lock-in.

---

## The Five Phases

| Phase | Name | What It Delivers | Status |
|-------|------|-----------------|--------|
| **1** | **Own** | An AI system you own and run | **Complete** |
| **2** | **Benefit** | An AI that helps you define and reach your goals | **In Progress** |
| **3** | **Connect** | Safe capabilities that act in the world on your behalf | **First proof in progress** |
| **4** | **Earn** | Personal AI systems collaborate and create value across relationships | Vision |
| **5** | **Decentralize** | Mature governance that depends on no single company | Vision |

**Phases and stages are different.** The five product phases describe long-horizon outcomes. Within Phase 3, the app platform uses a three-stage maturity path: first prove a BrainDrive-built app, then reviewed external apps, then broader open/federated app and capability participation. These stages do not replace the product phases. See the [app-platform summary](https://github.com/BrainDriveAI/BrainDrive-Library/blob/main/projects/production/braindrive-repo/foundation/app-platform-product-specs/README.md) for current scope and the [strategic vision](https://github.com/BrainDriveAI/BrainDrive-Library/blob/main/projects/production/braindrive-repo/foundation/phase-3-capability-ecosystem/vision.md) for the ecosystem direction.

---

## Phase 1: Own (Complete)

> Make it easy for anyone to own and run their own AI system.

**What shipped:**

- **Personal AI Architecture** — open, MIT-licensed foundation. Every component swappable, zero lock-in. Published as npm package with 212 tests and 13 CI checks.
- **BrainDrive** — first implementation of the architecture. Docker install, web interface, auth, model integration. MIT-licensed and fully functional.

**The key guarantee:** Your Memory is the platform. It depends on nothing; everything else depends on it. You can swap models, tools, interfaces, hosting — but Your Memory stays yours.

---

## Phase 2: Benefit (In Progress)

> Make your AI system so useful for managing your life that you can't imagine going back.

**The goal:** BrainDrive is useful across all areas of your life — by making it easy to partner with your AI to define and execute on your goals.

**Where this is showing up:**

- **Career.** Define what you want, plan how to get there, and stay accountable to the moves that matter.
- **Relationships.** Remember what matters about the people in your life — what you've discussed, what you want for them, what you want to do next.
- **Fitness.** Build the body and habits you want — define a plan, log progress, adjust as life happens.
- **Finances.** Take control of your money — define your goals, create a plan, set a budget when it helps, and reconcile uploaded statements against it.
- **Your Agent.** Talk through anything else that's on your mind — to-dos, hard conversations, meal planning, the everyday decisions that don't have their own page.

**And the ability to make your own.** BrainDrive ships with the surfaces above and the machinery to create and share new ones — yours, and others built by the community.

**Where we are right now.** BrainDrive can already get to know you and help you make a plan. We're now building the parts that help you execute on the plan and let changes in one area ripple into the related ones.

**Wherever you sit down to work with it.** Desktop today. Mobile, voice, and messaging as we get there. Your BrainDrive meets you where you are.

**And it has to be easy.** All of this has to be easy — easy to install, easy to set up, easy to use across the surfaces above, easy to recover when things go wrong. Phase 2 isn't done if every surface delivers value but you still need docs to get there. Easy is a scope item, not a polish pass.

---

## Phase 3: Connect (First Proof In Progress)

> Give your Personal AI safe, owner-controlled capabilities that can act in the world on your behalf.

Phase 2 builds the partnership. Phase 3 adds apps and capabilities, then extends them into outbound, owner-initiated action. The world does not yet establish ongoing relationships or shared state with your Personal AI; that belongs to Phase 4.

The first real proof is **Resume Builder on BrainDrive against the Shared App Contract**. The rollout is deliberately staged: Stage 1 is BrainDrive-built; Stage 2 adds curated external submissions; Stage 3 adds broader open/federated app and capability participation alongside the curated path. Only Stage 1 is being proved now; later stages are direction, not present capability.

- **Capability and app foundation** — verified apps add owner value through shared contracts without making technical setup the owner's job
- **General computer agency** — your BrainDrive uses browsers, apps, and interfaces the way you do
- **Agent teams** — specialized agents coordinate on complex tasks in parallel
- **Multi-channel presence** — your BrainDrive meets the world where it is
- **Device agency** — your BrainDrive acts through your devices, not just receiving input

---

## Phase 4: Earn (Vision)

> The world connects back — owners and independent Personal AI systems collaborate, create, and exchange value on their terms.

Phase 4 adds ongoing cross-owner and cross-system relationships: inbound connections, deliberately shared state, agent-to-agent coordination, and networked creator and agent economics. This is distinct from ordinary paid apps or Marketplace transactions, which may pass a separate paid gate earlier in the Phase 3 tactical path.

- **Systems come to you** — external services and agents establish permissioned relationships with your Personal AI
- **Shared work** — owners and their Personal AI systems collaborate through deliberately shared state with clear authority and attribution
- **Cross-system federation** — compatible Personal AI systems communicate over open protocols without becoming the same product
- **Portable expertise** — knowledge and methodology you've built becomes value others can benefit from
- **Networked creator and agent economics** — people share, sell, contribute, negotiate, and transact without surrendering ownership to a central platform
- **The Network** — when personal AI systems interact, they form an emergent collective intelligence

---

## Phase 5: Decentralize (Vision)

> Mature the governance and operations of an already-open ecosystem so it depends on no single company — including us.

Open contracts and independent implementation begin earlier; Phase 5 makes their stewardship and operation durably decentralized.

- **Community governance** — contributors propose and vote on direction
- **Distributed stewardship** — no single company controls the open protocols, conformance path, or ecosystem rules
- **Self-sustaining ecosystem** — runs because it serves its participants

---

## Learn More

- [Personal AI Capability Ecosystem — Strategic Vision](https://github.com/BrainDriveAI/BrainDrive-Library/blob/main/projects/production/braindrive-repo/foundation/phase-3-capability-ecosystem/vision.md)
- [App-Platform Product-Spec Summary](https://github.com/BrainDriveAI/BrainDrive-Library/blob/main/projects/production/braindrive-repo/foundation/app-platform-product-specs/README.md)
- [Phase 3 Capability Ecosystem — V1 Tactical Cut](https://github.com/BrainDriveAI/BrainDrive-Library/blob/main/projects/production/braindrive-repo/foundation/phase-3-capability-ecosystem/v1-cut.md)

---

## Want to Help?

BrainDrive is MIT-licensed and open source. We welcome contributions at every level:

- **Use it** — install BrainDrive, try the interview flow, report what works and what doesn't
- **Build on it** — the [Personal AI Architecture](https://github.com/Personal-AI-Architecture/the-architecture) is designed for anyone to build on
- **Contribute code** — check [open issues](https://github.com/BrainDriveAI/braindrive/issues) or pick something from the roadmap above
- **Join the community** — [community.braindrive.ai](https://community.braindrive.ai)

---

*Working to build a future where the power of AI belongs to the people.*
