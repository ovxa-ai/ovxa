(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Demo: three intents, three interfaces. Cycles until the visitor takes over.
  const intents = {
    compare: "Compare Q2 revenue against Q1 and show where growth was lost",
    approve: "Review this refund request and decide",
    investigate: "Why did checkout conversion drop last Tuesday?",
  };
  const order = Object.keys(intents);
  const tabs = Array.from(document.querySelectorAll(".tab[data-scene]"));
  const scenes = Array.from(document.querySelectorAll(".scene[id^='scene-']"));
  const intentNode = document.getElementById("demo-intent");
  const windowNode = document.querySelector(".window");
  let timer = 0;
  let current = 0;

  const show = (name) => {
    current = Math.max(0, order.indexOf(name));
    for (const tab of tabs) {
      const selected = tab.dataset.scene === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const scene of scenes) {
      const active = scene.id === `scene-${name}`;
      scene.hidden = !active;
      scene.dataset.active = String(active);
      if (active && !reduceMotion) {
        // Restart the enter animation so the surface visibly re-streams.
        for (const child of scene.children) {
          child.style.animation = "none";
          void child.offsetWidth;
          child.style.animation = "";
        }
      }
    }
    if (intentNode) intentNode.textContent = intents[name];
  };

  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = 0;
  };

  const start = () => {
    if (reduceMotion || timer) return;
    timer = window.setInterval(() => show(order[(current + 1) % order.length]), 6500);
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      stop();
      show(tab.dataset.scene);
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      stop();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = order[(current + step + order.length) % order.length];
      show(next);
      tabs.find((item) => item.dataset.scene === next)?.focus();
    });
  }

  if (windowNode) {
    windowNode.addEventListener("pointerenter", stop);
    windowNode.addEventListener("focusin", stop);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });

  if (tabs.length > 0 && scenes.length > 0) {
    show(order[0]);
    start();
  }

  // Copy-to-clipboard for the install command.
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
})();
