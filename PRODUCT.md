# Product

## Register

product

## Users

Product engineers and AI engineers who already have a model or agent working and are now stuck building the interface around it by hand. They reach for OVXA when chat is the wrong output: the user needs to compare, choose, configure, approve or investigate something, and a paragraph cannot do that.

## Product Purpose

OVXA's product is a UI Intelligence Engine. Given a user intent, application context, current state, available data, permissions, actions and a component system, it determines the best possible interface to present right now — the one most likely to help the user complete the intended task.

Schema, registry, protocol, compiler and renderer are infrastructure. They will become commodities. The moat is the decision: which interface, why, and whether it actually finished the job.

Success is not a surface that renders. Success is a generated interface that consistently beats both a chat transcript and a predetermined static screen on task completion, time, interaction count, abandonment, errors, corrections and conversion.

## Brand Personality

Serious developer infrastructure. Precise, technical, unhurried. Voice states mechanism, not ambition: "The Quality Engine ranks competing plans before anything is compiled," not "unlock the future of AI." The generated application surface is the hero; OVXA chrome gets out of the way.

## Anti-references

Generic purple AI SaaS (gradient orbs, hero metrics, "10x your workflow"). Chatbots with widgets bolted on. Agent-orchestration dashboards. "AI workforce", "agent operating system", "autonomous product platform". Anything that reads as LLM-generated HTML rather than a handcrafted product interface. Treating the renderer or schema as the product.

## Design Principles

- The generated surface is the hero. OVXA chrome recedes.
- The Quality Engine participates in generation. Multiple candidate plans are proposed, scored and ranked; only the winner is compiled.
- North star is task completion, not a successful render.
- Show the decision, not just the tree. Operators should see why this interface won.
- Fail closed, degrade gracefully. Unregistered components never render; an invalid model response costs you a simpler surface, never a blank screen.
- Patch, don't regenerate. User selections, form values, focus and scroll survive every model turn.
- Latency is a feature. Candidate ranking is cheap; generation is the expensive step and happens once.
- Generated UI must inherit the host's design system, not impose OVXA's.
- Outcomes feed the next decision. Completions, abandonments and corrections become priors.

## Accessibility & Inclusion

WCAG 2.2 AA as the floor, including inside generated surfaces: every registered component declares its keyboard and labelling behaviour, and the compiler rejects a node that cannot be described. Visible focus, honoured `prefers-reduced-motion`, no status encoded by colour alone, body contrast ≥ 4.5:1. Accessibility is a scored evaluation dimension, not a post-pass.
