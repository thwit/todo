// gist-sync.jsx — GitHub Gist backend.
//
// Stores items as a single JSON file inside a private gist. Token + gist id
// live in localStorage. When no creds are set, the app falls back to a
// local-only store (handled by the caller).
//
// API: useGistBackend({ initialItems }) -> {
//   items, setItems,        // the canonical item list (already debounced-synced)
//   creds,                  // { token, gistId } | null
//   saveCreds(c),           // persist creds and trigger a load
//   disconnect(),           // wipe creds (keeps last items locally)
//   createNewGist(token),   // POST a new gist seeded with current items
//   state,                  // 'idle' | 'loading' | 'syncing' | 'error' | 'offline' | 'unconfigured'
//   error,                  // last error message (string) | null
//   lastSync,               // ms timestamp of last successful sync | null
//   gistUrl,                // https://gist.github.com/... | null
// }

const { useState, useEffect, useRef, useCallback } = React;

const CREDS_KEY = "todo-gist-creds-v1";
const LOCAL_ITEMS_KEY = "todo-gist-items-v1";
const GIST_FILENAME = "todo.json";
const GIST_DESCRIPTION = "todo / gist — personal todo list";

// ── Creds storage ───────────────────────────────────────
function loadCreds() {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c.token || !c.gistId) return null;
    return c;
  } catch (e) { return null; }
}
function saveCredsLS(c) {
  if (!c) localStorage.removeItem(CREDS_KEY);
  else localStorage.setItem(CREDS_KEY, JSON.stringify(c));
}

function loadLocalItems(fallback) {
  try {
    const raw = localStorage.getItem(LOCAL_ITEMS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return fallback;
}
function saveLocalItems(items) {
  try { localStorage.setItem(LOCAL_ITEMS_KEY, JSON.stringify(items)); } catch (e) {}
}

// ── Gist API ────────────────────────────────────────────
async function gistFetch(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    let msg = `${res.status} ${res.statusText}`;
    try { const j = JSON.parse(txt); if (j.message) msg = j.message; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

async function readGist(token, gistId) {
  const gist = await gistFetch(`/gists/${gistId}`, { token });
  const file = gist.files?.[GIST_FILENAME] || Object.values(gist.files || {})[0];
  if (!file) return { items: [], gist };
  let content = file.content;
  // Gist API truncates large files; refetch raw URL when truncated.
  if (file.truncated && file.raw_url) {
    const rawRes = await fetch(file.raw_url);
    content = await rawRes.text();
  }
  let items = [];
  try {
    const parsed = JSON.parse(content || "[]");
    items = Array.isArray(parsed) ? parsed : (parsed.items || []);
  } catch (e) {
    throw new Error("gist file is not valid JSON");
  }
  return { items, gist };
}

async function writeGist(token, gistId, items) {
  return gistFetch(`/gists/${gistId}`, {
    token,
    method: "PATCH",
    body: {
      files: {
        [GIST_FILENAME]: { content: JSON.stringify(items, null, 2) },
      },
    },
  });
}

async function createGist(token, items) {
  const gist = await gistFetch(`/gists`, {
    token,
    method: "POST",
    body: {
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: { content: JSON.stringify(items, null, 2) },
      },
    },
  });
  return gist; // { id, html_url, ... }
}

// ── Hook ────────────────────────────────────────────────
function useGistBackend({ initialItems = [] } = {}) {
  const [creds, setCreds] = useState(() => loadCreds());
  const [items, _setItems] = useState(() => loadLocalItems(initialItems));
  const [state, setState] = useState(creds ? "loading" : "unconfigured");
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [gistUrl, setGistUrl] = useState(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const writeTimer = useRef(null);
  const inflight = useRef(false);
  const pending = useRef(false);

  // Initial fetch when we have creds.
  useEffect(() => {
    if (!creds) { setState("unconfigured"); return; }
    let cancelled = false;
    setState("loading");
    setError(null);
    readGist(creds.token, creds.gistId)
      .then(({ items: remote, gist }) => {
        if (cancelled) return;
        _setItems(remote);
        saveLocalItems(remote);
        setGistUrl(gist.html_url);
        setLastSync(Date.now());
        setState("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setState("error");
      });
    return () => { cancelled = true; };
  }, [creds?.token, creds?.gistId]);

  // Online/offline awareness.
  useEffect(() => {
    const goOffline = () => setState((s) => (s === "idle" || s === "syncing" ? "offline" : s));
    const goOnline = () => setState((s) => (s === "offline" ? "syncing" : s));
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Debounced write.
  const flushWrite = useCallback(async () => {
    if (!creds) return;
    if (inflight.current) { pending.current = true; return; }
    inflight.current = true;
    setState("syncing");
    setError(null);
    try {
      await writeGist(creds.token, creds.gistId, itemsRef.current);
      setLastSync(Date.now());
      setState("idle");
    } catch (err) {
      setError(err.message);
      setState("error");
    } finally {
      inflight.current = false;
      if (pending.current) {
        pending.current = false;
        flushWrite();
      }
    }
  }, [creds?.token, creds?.gistId]);

  const setItems = useCallback((updater) => {
    _setItems((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      saveLocalItems(next);
      // schedule a debounced gist write
      if (creds) {
        clearTimeout(writeTimer.current);
        writeTimer.current = setTimeout(flushWrite, 1200);
      }
      return next;
    });
  }, [creds, flushWrite]);

  const saveCreds = useCallback((c) => {
    saveCredsLS(c);
    setCreds(c);
    setError(null);
  }, []);

  const disconnect = useCallback(() => {
    saveCredsLS(null);
    setCreds(null);
    setGistUrl(null);
    setState("unconfigured");
    setError(null);
  }, []);

  const createNewGist = useCallback(async (token) => {
    setState("syncing");
    setError(null);
    try {
      const gist = await createGist(token, itemsRef.current);
      const c = { token, gistId: gist.id };
      saveCredsLS(c);
      setCreds(c);
      setGistUrl(gist.html_url);
      setLastSync(Date.now());
      setState("idle");
      return gist;
    } catch (err) {
      setError(err.message);
      setState("error");
      throw err;
    }
  }, []);

  // Manual refresh (pull from gist, discards local diff).
  const refresh = useCallback(async () => {
    if (!creds) return;
    setState("loading");
    setError(null);
    try {
      const { items: remote, gist } = await readGist(creds.token, creds.gistId);
      _setItems(remote);
      saveLocalItems(remote);
      setGistUrl(gist.html_url);
      setLastSync(Date.now());
      setState("idle");
    } catch (err) {
      setError(err.message);
      setState("error");
    }
  }, [creds?.token, creds?.gistId]);

  return {
    items, setItems,
    creds, saveCreds, disconnect, createNewGist, refresh,
    state, error, lastSync, gistUrl,
  };
}

// ── Settings sheet ──────────────────────────────────────
function SettingsSheet({ open, onClose, backend }) {
  const { creds, saveCreds, disconnect, createNewGist, refresh, state, error, lastSync, gistUrl } = backend;
  const [token, setToken] = useState(creds?.token || "");
  const [gistId, setGistId] = useState(creds?.gistId || "");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setToken(creds?.token || "");
      setGistId(creds?.gistId || "");
    }
  }, [open, creds]);

  if (!open) return null;

  const onConnect = (e) => {
    e.preventDefault();
    if (!token.trim() || !gistId.trim()) return;
    saveCreds({ token: token.trim(), gistId: gistId.trim() });
  };

  const onCreate = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try { await createNewGist(token.trim()); }
    catch (e) {}
    finally { setBusy(false); }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3 className="sheet-title">
            <span className="sheet-title-it">gist</span> backend
          </h3>
          <button className="sheet-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-body">
          {creds ? (
            <>
              <div className="sheet-row">
                <span className="sheet-lbl">status</span>
                <span className={`sheet-val sheet-state-${state}`}>
                  {stateLabel(state, error)}
                </span>
              </div>
              <div className="sheet-row">
                <span className="sheet-lbl">gist</span>
                <span className="sheet-val">
                  {gistUrl ? (
                    <a href={gistUrl} target="_blank" rel="noreferrer">
                      {creds.gistId.slice(0, 10)}…
                    </a>
                  ) : (
                    <span>{creds.gistId.slice(0, 10)}…</span>
                  )}
                </span>
              </div>
              <div className="sheet-row">
                <span className="sheet-lbl">last sync</span>
                <span className="sheet-val">{lastSync ? _gistRelTime(lastSync) + " ago" : "—"}</span>
              </div>
              {error && (
                <div className="sheet-err">{error}</div>
              )}
              <div className="sheet-actions">
                <button className="sh-btn" onClick={refresh} disabled={state === "loading" || state === "syncing"}>
                  Pull latest
                </button>
                <button className="sh-btn sh-btn-quiet" onClick={disconnect}>Disconnect</button>
              </div>
              <p className="sheet-foot">
                items live in your private gist as <code>{GIST_FILENAME}</code>. you can edit it
                anywhere — github.com, another device — and pull latest here.
              </p>
            </>
          ) : (
            <form onSubmit={onConnect}>
              <p className="sheet-intro">
                Use a private gist as your database. Create a fine-grained PAT with{" "}
                <strong>gists: read &amp; write</strong>, paste it below.
              </p>

              <label className="sheet-field">
                <span className="sheet-lbl">Personal access token</span>
                <div className="sheet-input-wrap">
                  <input
                    type={showToken ? "text" : "password"}
                    autoComplete="off"
                    spellCheck="false"
                    placeholder="github_pat_…"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <button
                    type="button"
                    className="sheet-eye"
                    onClick={() => setShowToken((s) => !s)}
                    aria-label={showToken ? "Hide token" : "Show token"}
                  >
                    {showToken ? "hide" : "show"}
                  </button>
                </div>
                <a className="sheet-hint" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                  create one →
                </a>
              </label>

              <label className="sheet-field">
                <span className="sheet-lbl">Gist ID</span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="paste an existing gist id, or create a new one ↓"
                  value={gistId}
                  onChange={(e) => setGistId(e.target.value.trim())}
                />
              </label>

              {error && <div className="sheet-err">{error}</div>}

              <div className="sheet-actions">
                <button
                  type="submit"
                  className="sh-btn sh-btn-primary"
                  disabled={!token.trim() || !gistId.trim() || busy}
                >
                  Connect
                </button>
                <button
                  type="button"
                  className="sh-btn"
                  disabled={!token.trim() || busy}
                  onClick={onCreate}
                >
                  {busy ? "creating…" : "Create new gist"}
                </button>
              </div>

              <p className="sheet-foot">
                Token is kept in this browser's localStorage only. Nothing is sent anywhere except
                api.github.com.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function stateLabel(state, error) {
  if (state === "error") return error ? `error · ${error}` : "error";
  if (state === "loading") return "loading…";
  if (state === "syncing") return "syncing…";
  if (state === "offline") return "offline";
  if (state === "unconfigured") return "not connected";
  return "connected";
}

function _gistRelTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

// Share with the main app
Object.assign(window, { useGistBackend, SettingsSheet, stateLabel });
