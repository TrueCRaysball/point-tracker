// Guided tour: dims the app, spotlights one part of the screen at a time and explains it.
//
// startTour(steps, { onEnd }) where each step is
//   { target: () => Element | null, title, text, before?: () => void }
// A step whose target can't be found is shown centered with no spotlight.

let tour = null; // { steps, i, onEnd, root }

export const touring = () => !!tour;

export function startTour(steps, { onEnd } = {}) {
  endTour(false);
  const root = Object.assign(document.createElement("div"), { id: "tour", className: "tour" });
  root.innerHTML = `<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"></div>`;
  document.body.append(root);
  tour = { steps, i: 0, onEnd, root };
  root.addEventListener("click", onClick);
  addEventListener("keydown", onKey, true);
  addEventListener("resize", place);
  show(0);
}

export function endTour(finished = false) {
  if (!tour) return;
  const { root, onEnd } = tour;
  tour = null;
  removeEventListener("keydown", onKey, true);
  removeEventListener("resize", place);
  root.classList.add("leaving");
  setTimeout(() => root.remove(), 180);
  onEnd?.(finished);
}

function show(i) {
  const step = tour.steps[i];
  tour.i = i;
  step.before?.();
  const card = tour.root.querySelector(".tour-card");
  const last = i === tour.steps.length - 1;
  card.innerHTML = `
    <div class="tour-count">${i + 1} of ${tour.steps.length}</div>
    <h3>${step.title}</h3>
    <p>${step.text}</p>
    <div class="tour-actions">
      ${last ? "" : `<button class="tour-skip" data-tour="skip">Skip Tour</button>`}
      <span class="tour-gap"></span>
      ${i > 0 ? `<button class="btn-subtle" data-tour="back">Back</button>` : ""}
      <button class="btn-primary" data-tour="next">${last ? "Finish" : "Next"}</button>
    </div>`;
  // Let the page settle (a step may switch pages) before measuring.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = step.target?.();
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    place();
    card.querySelector('[data-tour="next"]')?.focus({ preventScroll: true });
  }));
}

/** Moves the spotlight over the step's target and puts the card beside it, on screen. */
function place() {
  if (!tour) return;
  const step = tour.steps[tour.i];
  const spot = tour.root.querySelector(".tour-spot"), card = tour.root.querySelector(".tour-card");
  const el = step.target?.();
  const r = el?.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight, pad = 6, gap = 12, margin = 12;
  const cw = Math.min(360, vw - margin * 2);
  card.style.width = `${cw}px`;
  if (!r || (!r.width && !r.height)) {
    spot.classList.add("none");
    card.style.left = `${(vw - cw) / 2}px`;
    card.style.top = `${Math.max(margin, (vh - card.offsetHeight) / 2)}px`;
    return;
  }
  spot.classList.remove("none");
  const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
  const bottom = Math.min(vh - 4, r.bottom + pad), right = Math.min(vw - 4, r.right + pad);
  Object.assign(spot.style, { top: `${top}px`, left: `${left}px`, width: `${right - left}px`, height: `${bottom - top}px` });
  const ch = card.offsetHeight;
  let y;
  if (bottom + gap + ch <= vh - margin) y = bottom + gap; // below
  else if (top - gap - ch >= margin) y = top - gap - ch; // above
  else y = Math.min(vh - ch - margin, Math.max(margin, bottom - ch)); // overlap, kept on screen
  let x;
  if (right - left > cw) x = left + (right - left - cw) / 2;
  else x = left + (right - left) / 2 - cw / 2;
  // A tall target with no room above or below: put the card beside it instead.
  if (y < bottom && y + ch > top && (vw - right > cw + gap * 2 || left > cw + gap * 2)) {
    x = vw - right > cw + gap * 2 ? right + gap : left - gap - cw;
    y = Math.min(vh - ch - margin, Math.max(margin, top));
  }
  card.style.left = `${Math.min(vw - cw - margin, Math.max(margin, x))}px`;
  card.style.top = `${y}px`;
}

function onClick(e) {
  const b = e.target.closest("[data-tour]");
  e.stopPropagation();
  if (!b) return;
  const a = b.dataset.tour;
  if (a === "skip") endTour(false);
  else if (a === "back" && tour.i > 0) show(tour.i - 1);
  else if (a === "next") tour.i < tour.steps.length - 1 ? show(tour.i + 1) : endTour(true);
}

function onKey(e) {
  if (!tour) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endTour(false); }
  else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); tour.root.querySelector('[data-tour="next"]')?.click(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); tour.root.querySelector('[data-tour="back"]')?.click(); }
}
