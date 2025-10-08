BrainDrive's mission is to build a superior, **user-owned** alternative to Big Tech AI systems.

This is why BrainDrive-Core is **MIT licensed** and built on four pillars:

1. **Ownership** — You own your AI system  
2. **Freedom** — Your AI system is not restricted  
3. **Empowerment** — Your AI system is easy to use, customize, and build on  
4. **Sustainability** — Value flows to those who create it

If this mission resonates, we want to build with you:

* [**Roadmap**](https://docs.braindrive.ai/core/ROADMAP) — our 5-phase execution plan  
* [**GitHub Project**](https://github.com/orgs/BrainDriveAI/projects/1) — day-to-day priorities  
* [**Community Forum**](https://community.braindrive.ai/) — discuss ideas, get support, share plugins  
* [**Weekly dev livestream**](https://community.braindrive.ai/t/braindrive-development-progress-updates/92/33) — working sessions with the core team every Monday at 10am EST

## **Ways to Contribute**

### 1. Build Plugins (recommended)

BrainDrive-Core provides the foundation. [Plugins](https://docs.braindrive.ai/plugins/intro) provide the **freedom:**

Build whatever you want. Deploy it yourself. Share it if you choose.

* **No PR required** — No waiting for maintainer approval, no merge conflicts, no coordination overhead.  
* **You control deployment** — Host your plugin on your GitHub. Install with one click from BrainDrive's plugin manager.  
* **Save weeks of work** — Don't rebuild authentication, chat UI, model connections, or database layers. Focus only on your features.  
* **Your choice to share** — Keep plugins private, or share with the community. It's your choice.

Want a roleplay system? An expert assistant? A custom interface? **Build it as a plugin.**

Each plugin is a separate repository that loads dynamically via Webpack Module Federation. 

You own the code, the repo, and the distribution. No Big Tech lockin.

Ready to start building? **Start here:** [Plugin Developer QuickStart](https://docs.braindrive.ai/core/PLUGIN_DEVELOPER_QUICKSTART)

### 2. Improve Core (experienced developers)

Most features belong in plugins. Core contributions are the exception, not the rule.

**What Belongs in Core?**

* **Security** or **auth** improvements  
* New [**Service Bridges**]()   
* **Settings surfaces** that multiple plugins need

**What Doesn't belong in Core?**

* UI for your specific feature  
* Domain logic for your use case  
* Anything that can live in a plugin

**API Contributions**

Most core work is adding endpoints. Before you write custom docs:

1. Check the auto-generated docs at `localhost:8005/api/v1/docs`  
2. Look at existing [Service Bridges](https://docs.braindrive.ai/services/intro) as examples  
3. Follow the same patterns

We use standard approaches wherever possible. For example, if Ollama has a de facto standard for model communication, we use it. Same for image providers, audio providers, etc.

**PR Guidelines**

* **Small and focused** — one thing per PR  
* **Link to an issue** (or create one first)  
* **Tests/docs** if you're touching core behavior  
* **Screenshots** for UI changes  
* Use **Conventional Commits**: `feat(core): add ComfyUI service bridge`

We'll review within 2 business days (best effort while we're small). PRs aligned with the current roadmap phase get priority.

### 3. Docs, Examples & Issues

* Add plain-English explanations to developer guides  
* Contribute example personas and plugin samples  
* File bugs with clear repro steps, environment details, and logs

**Note:** We're building a one-click Debug Snapshot tool in Phase 2\. Until then, include version/commit, OS, browser, and relevant logs manually.

## **Current Reality Check**

We’re just now opening up to contributors. You'll be pioneering. Here's what that means:

* We're currently targeting experienced developers who can work independently  
* Limited bandwidth for hand-holding (Phase 3 of BrainDrive’s Roadmap will change this)  
* The process will evolve based on real contributor needs  
* Expect direct feedback, rapid iteration, learning together

If you're a new developer or need mentoring, bookmark us. We'll have infrastructure to support everyone in Phase 3 of the BrainDrive Roadmap.

## **Local Development**

See [install guide here](https://docs.braindrive.ai/core/INSTALL). 

### Quick Start

\# Backend  
cd backend  
python3 \-m venv .venv && source .venv/bin/activate  
pip install \-r requirements.txt  
uvicorn main:app \--host localhost \--port 8005

\# Frontend (new terminal)  
cd frontend  
npm install  
cp .env.example .env  
npm run dev

**URLs:**

* Frontend: http://localhost:5173  
* API docs: http://localhost:8005/api/v1/docs (← your API reference)

**When things break:** `git clean -xfd`, reinstall everything, try again.

---

## Roadmap

See the [full BrainDrive Roadmap here](https://docs.braindrive.ai/core/ROADMAP). 

Here's a brief summary of the BrainDrive roadmap phases:

**Phase 0: License Selection \- MIT** ✓ Complete

* Established MIT license to ensure user ownership and maximum freedom

**Phase 1: Foundation** (Current Focus)

* Cross-platform installation and first local AI chat experience with Ollama integration

**Phase 2: Developer Beta Release**

* Enable developers to build custom persona-based chat experiences and plugins with enhanced documentation

**Phase 3: Developer Release**

* Polish core system with clean code, refined UX, comprehensive documentation, and bug-free stability

**Phase 4: V1.0 Release**

* Make BrainDrive accessible to non-developers with one-click installers and GUI-based plugin marketplace

**Phase 5: Community Acceleration**

* Transition to community-driven development with advanced plugin ecosystem, multi-user capabilities, and sustainable, mission-aligned business models

Each phase builds toward the ultimate goal: a superior, user-owned alternative to Big Tech AI systems built on ownership, freedom, empowerment, and sustainability.

## What We Need Right Now

We’re about to move into Phase 2 of our roadmap. The goal of Phase 2 is for Developers to be able to easily build chat-based, role-playing experiences on their BrainDrive. We are looking for devs to help us:

* Identify and report bugs across BrainDrive-Core and Default plugins  
* Build persona-based experiences and share them  
* Contribute to BrainDrive’s first 3 community plugins  
* Improve documentation based on your learning journey

**Use Cases We're Targeting:**

We're focused on personal assistant experiences across diverse use cases. Think: research assistant, writing coach, domain expert consultants etc.

## Communication

* **Questions?** Post them in the [support forum](https://community.braindrive.ai/c/support-help/14).  
* **Found a bug?** Create an issue on the repo. Include: version/commit, OS, minimal repro steps, logs  
* **Security issue?** See [SECURITY.md](SECURITY.md) (private disclosure only)

We aim to respond to issues within 1 business day.

## License

All BrainDrive-Core contributions are MIT-licensed. By submitting a PR, you agree to these terms.

## Thank you for building with BrainDrive

If you're unsure whether something is a plugin or core, [ask in the forum](https://community.braindrive.ai/c/support-help/14). We'll help you ship the simplest thing that works.
