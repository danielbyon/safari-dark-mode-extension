(() => {
  // This parser-blocking script precedes the page's first stylesheet and visible content.
  const firstScript = { ms: performance.now(), readyState: document.readyState };
  const id = name => document.getElementById(name);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const sample = "Station check 42";
  const records = [];
  let confirmations = 0;
  let mutations = 0;
  let reevaluations = 0;
  let resourceCheck = "unmeasured";
  let adopted = "unmeasured";
  let requestedWP = false;
  const initialParams = new URLSearchParams(location.search);
  const policyRequest = initialParams.get("csp") === "strict" ? "strict" : "ordinary";
  const initialTheme = initialParams.get("theme");
  let requestedTheme = initialTheme === "dark" || initialTheme === "system" ? initialTheme : "light";
  let visit = "document";
  let revision = 0;

  function cssomResult(link) {
    if (!link) return "absent";
    if (!link.sheet) return "unloaded";
    try { return link.sheet.cssRules.length ? "readable" : "readable-empty"; }
    catch (error) { return error.name === "SecurityError" ? "unreadable" : "error"; }
  }

  // The fixture's active theme sheet supplies the reference colors even with the extension off.
  function themeRuleSample(link, computed) {
    try {
      const rule = link?.sheet?.cssRules[0];
      if (rule?.selectorText !== ":root") return null;
      const { color, backgroundColor: background } = rule.style;
      return { color, background, matchesRoot: computed.color === color && computed.backgroundColor === background };
    } catch {
      return null;
    }
  }

  function observe(action) {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const swatch = getComputedStyle(id("resource-swatch"));
    const swatchCSS = { color: swatch.color, background: swatch.backgroundColor, edge: swatch.borderLeftWidth };
    const fixTarget = getComputedStyle(id("fixture-essential-control"));
    const reference = id("deliberate-low-contrast");
    const referenceStyle = reference && getComputedStyle(reference);
    const meta = document.querySelector('meta[name="theme-color"]').content;
    const themeSheets = ["sheet-a", "sheet-b"].map(id);
    const siteSheetConditions = themeSheets.map(link => matchMedia(link.media).matches);
    const activeTheme = themeSheets.find((_, index) => siteSheetConditions[index]);
    // Record whether typed text survived. Never copy the text or document URL into the result.
    records.push({
      seq: ++revision, action, ms: Math.round(performance.now()), firstScript, visit,
      requestedTheme, systemDark: matchMedia("(prefers-color-scheme: dark)").matches,
      policyRequest, siteSheetConditions, themeRule: themeRuleSample(activeTheme, css),
      root: { scheme: css.colorScheme, color: css.color, background: css.backgroundColor },
      requestedWP, wpPreset: root.hasAttribute("data-wp-dark-mode-preset"),
      wpClass: root.classList.contains("wp-dark-mode-active"), wpAttribute: root.hasAttribute("data-wp-dark-mode-active"),
      meta: ["#f5eedc", "#26485d"].includes(meta) ? meta : "changed",
      sampleMatches: id("sample-input").value === sample, sampleFocused: document.activeElement === id("sample-input"),
      confirmations, mutations, reevaluations, adopted,
      control: { color: fixTarget.color, background: fixTarget.backgroundColor, outline: fixTarget.outlineWidth,
        outlineOffset: fixTarget.outlineOffset, focused: document.activeElement === id("fixture-essential-control") },
      lowContrast: referenceStyle && { color: referenceStyle.color, background: referenceStyle.backgroundColor },
      resource: { ...swatchCSS, cssom: cssomResult(id("resource-link")), fetch: resourceCheck },
    });
    if (records.length > 24) records.shift();
    id("result").textContent = JSON.stringify(records, null, 2);
  }

  function selectSheets(dark) {
    requestedTheme = dark ? "dark" : "light";
    id("sheet-a").media = dark ? "not all" : "all";
    id("sheet-b").media = dark ? "all" : "not all";
  }

  function mutateRootRule() {
    const link = ["sheet-a", "sheet-b"].map(id).find(element => matchMedia(element.media).matches);
    const style = link.sheet.cssRules[0].style;
    const dark = style.getPropertyValue("color-scheme") !== "dark";
    requestedTheme = dark ? "dark" : "light";
    style.setProperty("color-scheme", dark ? "dark" : "light");
    style.backgroundColor = dark ? "#182332" : "#fafafa";
    style.color = dark ? "#fafafa" : "#182332";
  }

  async function mutatePage() {
    mutations++;
    const alternate = mutations % 2 === 1;
    const dynamic = id("dynamic");
    const node = document.createElement("span");
    node.className = "dynamic-sample";
    node.textContent = ` Reading ${mutations}`;
    dynamic.append(node);
    dynamic.style.setProperty("--sample-color", alternate ? "#974121" : "#254561");
    node.style.borderColor = alternate ? "#558811" : "#4466bb";
    const link = document.querySelector('link[href^="/site"]');
    const nextLink = document.createElement("link");
    nextLink.rel = "stylesheet";
    nextLink.href = alternate ? "/site-update.css" : "/site.css";
    const loaded = new Promise((resolve, reject) => {
      nextLink.onload = resolve;
      nextLink.onerror = () => reject(new Error("sheet unavailable"));
    });
    link.replaceWith(nextLink);
    await loaded;
    const rule = Array.from(nextLink.sheet.cssRules).find(item => item.selectorText === ".dynamic-sample");
    rule.style.fontWeight = alternate ? "700" : "400";
    const host = id("shadow-host");
    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    shadow.textContent = `Shadow reading ${mutations}`;
    if ("adoptedStyleSheets" in shadow && typeof CSSStyleSheet.prototype.replaceSync === "function") {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`:host { color: ${alternate ? "#c03276" : "#164974"} }`);
      shadow.adoptedStyleSheets = [sheet];
      adopted = "assigned";
    } else {
      adopted = "unavailable";
    }
    id("series").setAttribute("fill", alternate ? "#76411a" : "#e6bf57");
    id("series").setAttribute("stroke", alternate ? "#128181" : "#174579");
  }

  async function checkResource() {
    const link = id("resource-link");
    if (!link) { resourceCheck = "absent"; return; }
    try {
      const response = await fetch(link.href, { mode: "cors", credentials: "omit", cache: "no-store" });
      const bytes = await response.text();
      resourceCheck = response.ok && bytes.length > 0 ? "readable" : "failed-response";
    } catch { resourceCheck = "read-failed"; }
  }

  const pathChange = () => location.pathname === "/next/page.html" ? "/page.html" : "/next/page.html";
  const currentQuery = () => new URLSearchParams(location.search);
  async function act(action) {
    switch (action) {
      case "sample":
        id("sample-input").value = sample;
        id("sample-input").focus();
        break;
      case "check": break;
      case "focus-control": id("fixture-essential-control").focus(); break;
      case "light": case "dark": selectSheets(action === "dark"); break;
      case "cssom": mutateRootRule(); break;
      case "wp-on": case "wp-off":
        if (!document.documentElement.hasAttribute("data-wp-dark-mode-preset")) {
          observe("wp-preset-absent");
          return;
        }
        requestedWP = action === "wp-on";
        document.documentElement.classList.toggle("wp-dark-mode-active", requestedWP);
        document.documentElement.toggleAttribute("data-wp-dark-mode-active", requestedWP);
        break;
      case "reevaluate": {
        const node = document.createElement("span");
        node.textContent = ` Sensor check ${++reevaluations}`;
        id("dynamic").append(node);
        break;
      }
      case "mutation": await mutatePage(); break;
      case "gated-mutation": {
        observe("mutation-waiting");
        const response = await fetch("/control/mutation", { cache: "no-store" });
        if (!response.ok || await response.text() !== "released") throw new Error("release unavailable");
        await mutatePage();
        break;
      }
      case "resource": await checkResource(); break;
      case "push": case "replace": {
        history[action === "push" ? "pushState" : "replaceState"]({}, "", pathChange() + location.search);
        document.querySelector('meta[name="theme-color"]').content = "#26485d";
        visit = action;
        break;
      }
      case "same-url": history.pushState({}, ""); break;
      case "query": {
        const params = currentQuery();
        params.set("step", params.get("step") === "1" ? "2" : "1");
        history.pushState({}, "", `?${params}${location.hash}`);
        visit = "query";
        break;
      }
      case "fragment": location.hash = location.hash === "#station" ? "station-two" : "station"; break;
      case "anchor": id("anchor-link").click(); break;
      case "back": history.back(); return;
      case "forward": history.forward(); return;
      case "new-document": location.assign(pathChange() + location.search); return;
      case "cross-host": location.assign(id("cross-link").href + location.search); return;
      case "reload": location.reload(); return;
      default: return;
    }
    // Give page and candidate mutation observers a turn before sampling their resulting styles.
    await frame();
    await frame();
    observe(action);
  }

  addEventListener("DOMContentLoaded", () => {
    const run = action => act(action).catch(() => observe(`${action}-failed`));
    id("run").onclick = () => run(id("action").value);
    if (id("queue")) id("queue").onclick = () => {
      const action = id("action").value;
      observe(`${action}-queued`);
      setTimeout(() => run(action), 5000);
    };
    id("fixture-essential-control").onclick = () => {
      id("confirmations").textContent = String(++confirmations);
      observe("confirmed");
    };
    addEventListener("popstate", () => { visit = "history"; observe("popstate"); });
    addEventListener("hashchange", () => { visit = "fragment"; observe("hashchange"); });
    addEventListener("pageshow", event => observe(event.persisted ? "restored" : "pageshow"));
    const system = matchMedia("(prefers-color-scheme: dark)");
    system.addEventListener("change", () => run("check"));
    observe("dom-ready");
    run("check");
  });
})();
