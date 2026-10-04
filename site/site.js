(() => {
  "use strict";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const nav = document.querySelector(".mk-nav");
  const onScroll = () => {
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const menuBtn = document.querySelector(".mk-menu-btn");
  const drawer = document.getElementById("mk-drawer");
  const setMenu = (open) => {
    if (!menuBtn || !drawer) return;
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    drawer.hidden = !open;
  };
  menuBtn?.addEventListener("click", () => {
    setMenu(menuBtn.getAttribute("aria-expanded") !== "true");
  });
  drawer?.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) setMenu(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
  });

  for (const button of document.querySelectorAll("button[data-copy]")) {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
      } catch {
        return;
      }
      button.dataset.copied = "true";
      button.setAttribute("aria-label", "Copied");
      window.setTimeout(() => {
        delete button.dataset.copied;
        button.setAttribute("aria-label", "Copy install command");
      }, 1600);
    });
  }

  const tabs = Array.from(document.querySelectorAll(".hosts-tabs [data-host]"));
  const compares = Array.from(document.querySelectorAll(".compare[data-host]"));
  const hosts = compares.map((node) => node.dataset.host);
  let active = "northline";
  let run = 0;

  const placeCursor = (stage) => {
    if (!stage) return;
    const cursor = stage.querySelector(".flow-cursor");
    const hot = stage.querySelector(".is-on [data-hot], [data-hot]");
    if (!cursor || !hot) return;
    const bounds = stage.getBoundingClientRect();
    const target = hot.getBoundingClientRect();
    cursor.style.left = `${target.left - bounds.left + target.width / 2 - (5.2 / 24) * 22}px`;
    cursor.style.top = `${target.top - bounds.top + target.height / 2 - (2.8 / 24) * 22}px`;
  };

  const setHere = (header, name) => {
    if (!header) return;
    for (const link of header.querySelectorAll("nav span")) {
      const label = link.dataset.link || link.textContent;
      link.classList.toggle("is-here", label === name);
    }
  };

  const replay = (node) => {
    if (!node || reduce) return;
    node.style.animation = "none";
    void node.offsetWidth;
    node.style.animation = "";
  };

  const showWithout = (compare, step) => {
    const screen = compare.querySelector(".without .flow-screen");
    if (!screen) return;
    for (const pane of screen.querySelectorAll("[data-step]")) {
      pane.classList.toggle("is-on", Number(pane.dataset.step) === step);
    }
    replay(screen);
    const names = compare.dataset.without.split(",");
    setHere(compare.querySelector(".without .site-nav"), names[step] || names[0]);
    placeCursor(compare.querySelector(".without .flow-stage"));
  };

  const showWith = (compare, phase) => {
    const ask = compare.querySelector(".with-ask");
    const induct = compare.querySelector(".ovxa-induction");
    const result = compare.querySelector(".site-result");
    const stage = compare.querySelector(".with .flow-stage");
    if (ask) ask.hidden = phase === "done";
    if (induct) {
      induct.hidden = phase !== "induct";
      if (phase === "induct") {
        for (const node of induct.querySelectorAll(".induct-frame, .induct-bar, .induct-a, .induct-b, .induct-word")) {
          replay(node);
        }
      }
    }
    if (result) {
      result.hidden = phase !== "done";
      result.classList.toggle("is-in", phase === "done");
    }
    if (stage) stage.classList.toggle("is-down", phase === "down");
    setHere(compare.querySelector(".with .site-nav"), phase === "done" ? compare.dataset.done : compare.dataset.idle);
    if (phase === "ask" || phase === "down") placeCursor(stage);
  };

  const sleep = (ms, token) =>
    new Promise((resolve) => {
      window.setTimeout(() => resolve(token === run), ms);
    });

  const play = async (name) => {
    const token = ++run;
    const compare = compares.find((node) => node.dataset.host === name);
    if (!compare) return;
    if (reduce) {
      showWithout(compare, 0);
      showWith(compare, "done");
      return;
    }
    let step = 0;
    showWithout(compare, 0);
    const left = window.setInterval(() => {
      if (token !== run) {
        window.clearInterval(left);
        return;
      }
      step = (step + 1) % 6;
      showWithout(compare, step);
    }, 1800);

    showWith(compare, "ask");
    while (token === run) {
      const stage = compare.querySelector(".with .flow-stage");
      stage?.classList.remove("is-down");
      showWith(compare, "ask");
      if (!(await sleep(640, token))) break;
      stage?.classList.add("is-down");
      if (!(await sleep(360, token))) break;
      showWith(compare, "down");
      if (!(await sleep(260, token))) break;
      showWith(compare, "induct");
      if (!(await sleep(1760, token))) break;
      showWith(compare, "done");
      if (!(await sleep(4200, token))) break;
    }
    window.clearInterval(left);
  };

  const selectHost = (name) => {
    active = name;
    for (const tab of tabs) {
      const selected = tab.dataset.host === name;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const compare of compares) {
      const on = compare.dataset.host === name;
      compare.hidden = !on;
      compare.dataset.active = String(on);
    }
    void play(name);
  };

  const tablist = document.querySelector(".hosts-tabs");
  tablist?.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const current = hosts.indexOf(active);
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? hosts.length - 1
          : event.key === "ArrowRight"
            ? (current + 1) % hosts.length
            : (current - 1 + hosts.length) % hosts.length;
    selectHost(hosts[next]);
    tabs[next]?.focus();
  });
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectHost(tab.dataset.host));
  }

  const start = () => selectHost("northline");
  const hostSection = document.querySelector(".hosts");
  if (reduce || !hostSection || !("IntersectionObserver" in window)) {
    start();
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        start();
      },
      { threshold: 0.15 },
    );
    observer.observe(hostSection);
  }
})();
