/* The lock of the page. The site that GitHub Pages serves holds the real page sealed (compressed, then AES-256-GCM,
   by tools/lock.py), and this script opens it in the browser with WebCrypto. The key is not in the file: it comes in
   the link, after the #, which a browser never sends to a server. Whoever opens the address without it gets a box to
   paste the link in. Once a key opens the page, the browser keeps it, so the address alone works next time, and the
   key leaves the address bar; the page's About forgets it. Under node it is the tests' way in (EconLock). */
(function (root) {
  "use strict";
  const L = {FORMAT: "econ-lock/1", STORE: "econ-results-key"};

  // base64 or base64url text as bytes
  L.bytes = function (text) {
    const raw = root.atob(String(text).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, ""));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

  // The key in a text: a link that carries it (#k=KEY), or its 43 characters alone; null when there is none
  L.keyOf = function (text) {
    const m = /(?:^|[#&?])k=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(String(text)) || /^\s*([A-Za-z0-9_-]{43})\s*$/.exec(String(text));
    return m ? m[1] : null;
  };

  // The page's HTML from its sealed text; rejects when the key is not the page's or the page was changed
  L.open = async function (key, iv, sealed) {
    const subtle = root.crypto.subtle;
    const k = await subtle.importKey("raw", L.bytes(key), {name: "AES-GCM"}, false, ["decrypt"]);
    const packed = await subtle.decrypt({name: "AES-GCM", iv: L.bytes(iv), additionalData: new root.TextEncoder().encode(L.FORMAT)},
      k, L.bytes(sealed));
    const stream = new root.Blob([packed]).stream().pipeThrough(new root.DecompressionStream("deflate"));
    return new root.Response(stream).text();
  };

  root.EconLock = L;
  if (typeof document === "undefined") return;

  const box = document.getElementById("lock"), form = document.getElementById("form"), input = document.getElementById("key"),
    status = document.getElementById("status"), sealed = document.getElementById("sealed");
  function stores() {  // where the key can be kept: for good, or for this tab; a browser may refuse both
    const out = [];
    for (const name of ["localStorage", "sessionStorage"]) {
      try { const s = root[name]; s.getItem(L.STORE); out.push(s); } catch (e) { /* not this one */ }
    }
    return out;
  }
  function kept() {
    for (const s of stores()) { const v = s.getItem(L.STORE); if (v) return v; }
    return null;
  }
  function keep(key) {
    for (const s of stores()) { try { s.setItem(L.STORE, key); return true; } catch (e) { /* full, or refused */ } }
    return false;
  }
  function forget() { for (const s of stores()) { try { s.removeItem(L.STORE); } catch (e) { /* nothing kept there */ } } }
  function clean() {  // the address without the key: what is left of the # is the page's own view
    const h = new URLSearchParams(root.location.hash.slice(1));
    h.delete("k");
    const rest = h.toString();
    try { root.history.replaceState(null, "", root.location.pathname + root.location.search + (rest ? "#" + rest : "")); } catch (e) { /* refused on some file:// pages */ }
  }
  async function attempt(key) {
    let html;
    try { html = await L.open(key, sealed.dataset.iv, sealed.textContent); } catch (e) { return false; }
    if (keep(key)) clean();  // with nowhere to keep it, the key stays in the address for a reload
    document.open();
    document.write(html);
    document.close();
    return true;
  }
  function ask(text) {
    box.hidden = false;
    status.textContent = text;
    if (!form.hidden) input.focus();
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const key = L.keyOf(input.value);
    if (!key) { status.textContent = "That is not a link to this page, nor its key."; return; }
    status.textContent = "Opening…";
    if (!(await attempt(key))) status.textContent = "That key does not open this page. Ask for the current link.";
  });

  (async function () {
    if (!root.crypto || !root.crypto.subtle || typeof root.DecompressionStream === "undefined") {
      form.hidden = true;
      ask("This browser cannot open the page. It needs a current browser, and the page served over https.");
      return;
    }
    const linked = L.keyOf(root.location.hash), mine = kept();
    if (linked && await attempt(linked)) return;
    if (mine && mine !== linked && await attempt(mine)) return;
    if (mine) forget();
    ask(linked ? "This link's key does not open the page. Ask for the current link."
      : mine ? "The page's key has changed since this browser last opened it. Ask for the current link." : "");
  })();
})(typeof window !== "undefined" ? window : globalThis);
