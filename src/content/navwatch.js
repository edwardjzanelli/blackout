// In-page navigation watch (design 5.3a, 5.4). Facebook, YouTube and Instagram
// are single-page apps: they change the URL with the history API (pushState /
// replaceState) and swap content without a document load, so the content script
// never re-runs. The whole-page search rule (3.6) reads the URL, so a results
// page reached by an in-app search (e.g. Facebook, whose title stays "Facebook"
// and whose only signal is the ?q= in the URL) is never covered.
//
// This notices URL changes without patching the page's history object: it uses
// the Navigation API where available (which reports pushState/replaceState), and
// otherwise polls location.href no more often than every 500 ms. popstate and
// hashchange are cheap immediate signals and are always observed. onChange fires
// only on a real href change.

/** Minimum gap between polls when the Navigation API is absent (design 5.4). */
export const POLL_MS = 500;

/** @param {Window} win @returns {string} */
function hrefOf(win) {
  try {
    return win.location.href;
  } catch {
    return "";
  }
}

/**
 * Watch win for in-page URL changes and call onChange(newHref) on each real
 * change. Returns a cleanup function that removes every listener/timer.
 * @param {Window} win
 * @param {(href: string) => void} onChange
 * @returns {() => void}
 */
export function watchNavigation(win, onChange) {
  let last = hrefOf(win);
  const fire = () => {
    const href = hrefOf(win);
    if (href === last) return;
    last = href;
    onChange(href);
  };

  const cleanups = [];
  for (const type of ["popstate", "hashchange"]) {
    win.addEventListener(type, fire);
    cleanups.push(() => win.removeEventListener(type, fire));
  }

  const nav = win.navigation;
  if (nav && typeof nav.addEventListener === "function") {
    // Fires after the current history entry changes, including pushState and
    // replaceState, so no polling or history patching is needed.
    nav.addEventListener("currententrychange", fire);
    cleanups.push(() => nav.removeEventListener("currententrychange", fire));
  } else {
    const id = win.setInterval(fire, POLL_MS);
    cleanups.push(() => win.clearInterval(id));
  }

  return () => {
    for (const c of cleanups) c();
  };
}
