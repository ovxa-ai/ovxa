(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  /* Demo ------------------------------------------------------------------ */

  const intents = {
    compare: "Compare Q2 revenue against Q1 and show where growth was lost",
    approve: "Review this refund request and decide",
    investigate: "Why did checkout conversion drop last Tuesday?",
  };
  /** Illustrative rankings. The caption says these are not live engine scores. */
  const decisions = {
    compare: {
      rationale: "Selected comparison over chat. Strongest signal: task completion.",
      plans: [
        { rank: "01", name: "Comparison", why: "Two periods side by side, with the delta.", verdict: "Wins", winner: true },
        { rank: "02", name: "Static dashboard", why: "Built for one quarter, not this question.", verdict: "Loses" },
        { rank: "03", name: "Chat", why: "A paragraph cannot compare two periods.", verdict: "Loses" },
      ],
    },
    approve: {
      rationale: "Selected decision over chat. Strongest signal: task completion.",
      plans: [
        { rank: "01", name: "Decision", why: "The facts, the risk, and one clear action.", verdict: "Wins", winner: true },
        { rank: "02", name: "Refund form", why: "A blank form, not this request.", verdict: "Loses" },
        { rank: "03", name: "Chat", why: "A paragraph cannot take the action.", verdict: "Loses" },
      ],
    },
    investigate: {
      rationale: "Selected investigation over chat. Strongest signal: task completion.",
      plans: [
        { rank: "01", name: "Investigation", why: "A funnel, the anomaly, and the sources.", verdict: "Wins", winner: true },
        { rank: "02", name: "Checkout dashboard", why: "The usual charts, not last Tuesday.", verdict: "Loses" },
        { rank: "03", name: "Chat", why: "A paragraph cannot show the funnel.", verdict: "Loses" },
      ],
    },
  };
  const order = Object.keys(intents);
  const tabs = Array.from(document.querySelectorAll(".tab[data-scene]"));
  const scenes = Array.from(document.querySelectorAll(".scene[id^='scene-']"));
  const intentNode = document.getElementById("demo-intent");
  const stateNode = document.querySelector(".sbar .state");
  const decision = document.querySelector(".decision");
  const candidateList = document.getElementById("candidates");
  const rationaleNode = document.getElementById("decision-rationale");
  const bar = document.querySelector(".sbar");
  const windowNode = document.querySelector(".window");

  let run = 0;
  let current = 0;
  let autoplay = true;

  const setPhase = (phase, label) => {
    if (!stateNode) return;
    stateNode.dataset.phase = phase;
    stateNode.querySelector("span").textContent = label;
    if (bar) bar.dataset.phase = phase;
  };

  const selectTab = (name) => {
    for (const tab of tabs) {
      const selected = tab.dataset.scene === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  };

  const hideScenes = () => {
    for (const scene of scenes) {
      scene.hidden = true;
      scene.dataset.active = "false";
    }
  };

  const revealScene = (name) => {
    for (const scene of scenes) {
      const active = scene.id === `scene-${name}`;
      scene.hidden = !active;
      scene.dataset.active = String(active);
      if (active && !reduceMotion) {
        for (const child of scene.children) {
          child.style.animation = "none";
          void child.offsetWidth;
          child.style.animation = "";
        }
      }
    }
  };

  const hideDecision = () => {
    if (decision) decision.hidden = true;
  };

  const showDecision = (name) => {
    const spec = decisions[name];
    if (!decision || !candidateList || !rationaleNode || !spec) return;
    candidateList.replaceChildren();
    for (const plan of spec.plans) {
      const item = document.createElement("li");
      item.className = "candidate";
      if (plan.winner) item.dataset.winner = "true";

      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = plan.rank;

      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = plan.name;
      const why = document.createElement("span");
      why.textContent = plan.why;
      body.append(title, why);

      const verdict = document.createElement("span");
      verdict.className = "verdict";
      verdict.textContent = plan.verdict;

      item.append(rank, body, verdict);
      candidateList.append(item);
    }
    rationaleNode.textContent = spec.rationale;
    decision.hidden = false;
    if (!reduceMotion) {
      for (const child of candidateList.children) {
        child.style.animation = "none";
        void child.offsetWidth;
        child.style.animation = "";
      }
    }
  };

  const typeIntent = async (text, token) => {
    if (!intentNode) return;
    if (reduceMotion) {
      intentNode.textContent = text;
      return;
    }
    intentNode.textContent = "";
    for (let index = 1; index <= text.length; index += 1) {
      if (token !== run) return;
      intentNode.textContent = text.slice(0, index);
      const char = text[index - 1];
      await sleep(char === " " ? 34 : 18 + Math.random() * 22);
    }
  };

  /** One full pass: type the intent, choose a plan, stream the surface, settle. */
  const show = async (name) => {
    const token = ++run;
    current = Math.max(0, order.indexOf(name));
    selectTab(name);

    if (reduceMotion) {
      if (intentNode) intentNode.textContent = intents[name];
      hideDecision();
      revealScene(name);
      setPhase("ready", "Ready");
      return;
    }

    hideScenes();
    hideDecision();
    setPhase("typing", "");
    await typeIntent(intents[name], token);
    if (token !== run) return;

    setPhase("planning", "Choosing an interface");
    showDecision(name);
    await sleep(1680);
    if (token !== run) return;

    hideDecision();
    setPhase("building", "Building");
    revealScene(name);
    await sleep(820);
    if (token !== run) return;

    setPhase("ready", "Ready");

    if (!autoplay) return;
    await sleep(5200);
    if (token !== run || !autoplay || document.hidden) return;
    void show(order[(current + 1) % order.length]);
  };

  const takeOver = () => {
    autoplay = false;
  };

  for (const card of document.querySelectorAll(".usecase[data-scene]")) {
    card.addEventListener("click", () => {
      takeOver();
      const demo = document.getElementById("demo");
      if (demo) demo.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      void show(card.dataset.scene);
    });
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      takeOver();
      void show(tab.dataset.scene);
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      takeOver();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = order[(current + step + order.length) % order.length];
      void show(next);
      tabs.find((item) => item.dataset.scene === next)?.focus();
    });
  }

  if (windowNode) {
    windowNode.addEventListener("focusin", takeOver);
  }

  document.addEventListener("visibilitychange", () => {
    // Resume the cycle when the tab comes back, unless the visitor took over.
    if (!document.hidden && autoplay && stateNode?.dataset.phase === "ready") {
      void show(order[(current + 1) % order.length]);
    }
  });

  if (tabs.length > 0 && scenes.length > 0) {
    // Let the hero paint first; the demo starts as the eye reaches it.
    window.setTimeout(() => void show(order[0]), reduceMotion ? 0 : 500);
  }

  /* Copy to clipboard ------------------------------------------------------ */

  for (const button of document.querySelectorAll("button[data-copy]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        button.dataset.copied = "true";
        button.setAttribute("aria-label", "Copied");
        window.setTimeout(() => {
          delete button.dataset.copied;
          button.setAttribute("aria-label", "Copy install command");
        }, 1600);
      } catch {
        // Clipboard access denied: the command is visible next to the button.
      }
    });
  }

  /* Scroll reveal ---------------------------------------------------------- */

  const revealables = Array.from(document.querySelectorAll("[data-reveal]"));
  if (revealables.length > 0 && !reduceMotion && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.dataset.reveal = "in";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    for (const node of revealables) observer.observe(node);
  } else {
    for (const node of revealables) node.dataset.reveal = "in";
  }
})();
