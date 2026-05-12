// Todo / Gist — main app.
// Scandinavian-architect aesthetic: paper, hairlines, breath.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─────────────────────────────────────────────────────────────────────────────
// Storage / sync — real gist backend lives in gist-sync.jsx.
// ─────────────────────────────────────────────────────────────────────────────
const VIEW_KEY = "todo-gist-view-v1";

const seedItems = [
  { id: "a1", title: "Read draft of Solveig's thesis", status: "doing", createdAt: Date.now() - 86400000 * 3 },
  { id: "a2", title: "Sketch the courtyard pavilion", status: "doing", createdAt: Date.now() - 86400000 * 2 },
  { id: "a3", title: "Send revised invoice to studio Ø", status: "todo", createdAt: Date.now() - 86400000 * 1 },
  { id: "a4", title: "Pick up linen runner", status: "todo", createdAt: Date.now() - 86400000 * 1 },
  { id: "a5", title: "Call about the oak shipment", status: "todo", createdAt: Date.now() - 3600000 * 8 },
  { id: "a6", title: "Renew library card", status: "done", createdAt: Date.now() - 86400000 * 5 },
  { id: "a7", title: "Book ferry, Friday afternoon", status: "done", createdAt: Date.now() - 86400000 * 4 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Item primitives
// ─────────────────────────────────────────────────────────────────────────────
const STATUSES = ["todo", "doing", "done"];
const STATUS_LABEL = { todo: "To do", doing: "Doing", done: "Done" };

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const backend = useGistBackend({ initialItems: seedItems });
  const { items, setItems, state: syncState, creds } = backend;
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || "list");
  const [draftTitle, setDraftTitle] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => localStorage.setItem(VIEW_KEY, view), [view]);

  // Keyboard: ⌘K / Ctrl+K focuses the input. V toggles view.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); inputRef.current?.focus();
      } else if (!inField && e.key.toLowerCase() === "v") {
        setView((v) => (v === "list" ? "board" : "list"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addItem = (title, status = "todo") => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setItems((xs) => [{ id: uid(), title: trimmed, status, createdAt: Date.now() }, ...xs]);
    setDraftTitle("");
  };

  const updateItem = (id, patch) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const removeItem = (id) => setItems((xs) => xs.filter((x) => x.id !== id));

  const cycleStatus = (id) => {
    setItems((xs) =>
      xs.map((x) => {
        if (x.id !== id) return x;
        const i = STATUSES.indexOf(x.status);
        return { ...x, status: STATUSES[(i + 1) % STATUSES.length] };
      })
    );
  };

  const reorder = (id, targetId, position /* before | after */) => {
    setItems((xs) => {
      const a = xs.find((x) => x.id === id);
      if (!a) return xs;
      const rest = xs.filter((x) => x.id !== id);
      const idx = rest.findIndex((x) => x.id === targetId);
      if (idx < 0) return [a, ...rest];
      const insertAt = position === "before" ? idx : idx + 1;
      return [...rest.slice(0, insertAt), a, ...rest.slice(insertAt)];
    });
  };

  const moveToStatus = (id, status, targetId, position) => {
    setItems((xs) => {
      let next = xs.map((x) => (x.id === id ? { ...x, status } : x));
      if (targetId) {
        const a = next.find((x) => x.id === id);
        next = next.filter((x) => x.id !== id);
        const idx = next.findIndex((x) => x.id === targetId);
        const insertAt = position === "before" ? idx : idx + 1;
        next = [...next.slice(0, insertAt), a, ...next.slice(insertAt)];
      }
      return next;
    });
  };

  const counts = useMemo(() => {
    const c = { todo: 0, doing: 0, done: 0 };
    items.forEach((x) => (c[x.status] = (c[x.status] || 0) + 1));
    return c;
  }, [items]);

  // Apply theme via CSS variables on the root.
  useEffect(() => {
    const root = document.documentElement;
    const p = t.palette || ["#efeae0", "#1a1814", "#a8624a"];
    root.style.setProperty("--paper", p[0]);
    root.style.setProperty("--ink", p[1]);
    root.style.setProperty("--accent", p[2]);
    root.style.setProperty("--density", t.density === "compact" ? "0.78" : t.density === "comfy" ? "1.15" : "1");
    root.dataset.serifWordmark = t.serifWordmark ? "on" : "off";
    root.dataset.numbers = t.showNumbers ? "on" : "off";
  }, [t]);

  return (
    <div className="page">
      <Header
        view={view}
        setView={setView}
        syncState={syncState}
        creds={creds}
        onOpenSettings={() => setSettingsOpen(true)}
        counts={counts}
      />

      <main className="main">
        <Composer
          ref={inputRef}
          value={draftTitle}
          onChange={setDraftTitle}
          onSubmit={() => addItem(draftTitle)}
        />

        <div className={`view view-${view}`}>
          {view === "list" ? (
            <ListView
              items={items}
              onCycle={cycleStatus}
              onUpdate={updateItem}
              onRemove={removeItem}
              onReorder={reorder}
              editingId={editingId}
              setEditingId={setEditingId}
            />
          ) : (
            <BoardView
              items={items}
              onCycle={cycleStatus}
              onUpdate={updateItem}
              onRemove={removeItem}
              onMove={moveToStatus}
              onAdd={addItem}
              editingId={editingId}
              setEditingId={setEditingId}
            />
          )}
        </div>
      </main>

      <Footnotes counts={counts} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Palette" />
        <TweakColor
          label="Paper / ink / accent"
          value={t.palette}
          options={[
            ["#efeae0", "#1a1814", "#a8624a"], // bone + clay
            ["#f1ede4", "#211f1b", "#5b6b4e"], // bone + moss
            ["#ece8df", "#1a1814", "#1a1814"], // bone + ink (no color)
            ["#e6e1d4", "#22201b", "#7a6a55"], // linen + walnut
            ["#15140f", "#ece7da", "#c9a25d"], // night
          ]}
          onChange={(v) => setTweak("palette", v)}
        />
        <TweakSection label="Type" />
        <TweakToggle
          label="Italic serif wordmark"
          value={t.serifWordmark}
          onChange={(v) => setTweak("serifWordmark", v)}
        />
        <TweakSection label="Layout" />
        <TweakRadio
          label="Density"
          value={t.density}
          options={["compact", "regular", "comfy"]}
          onChange={(v) => setTweak("density", v)}
        />
        <TweakToggle
          label="Show item numbers"
          value={t.showNumbers}
          onChange={(v) => setTweak("showNumbers", v)}
        />
      </TweaksPanel>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        backend={backend}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────
function Header({ view, setView, syncState, creds, onOpenSettings, counts }) {
  return (
    <header className="hdr">
      <div className="hdr-l">
        <div className="wordmark">
          <span className="wm-todo">todo</span>
          <span className="wm-dot">.</span>
          <span className="wm-sub">gist</span>
        </div>
        <SyncDot state={syncState} configured={!!creds} onClick={onOpenSettings} />
      </div>

      <ViewToggle view={view} setView={setView} />
    </header>
  );
}

function SyncDot({ state, configured, onClick }) {
  let label;
  if (!configured) label = "not connected · click to set up";
  else if (state === "loading") label = "loading…";
  else if (state === "syncing") label = "syncing…";
  else if (state === "offline") label = "offline";
  else if (state === "error") label = "sync error · click to check";
  else label = "synced to gist";
  return (
    <button
      type="button"
      className={`sync sync-${state} ${configured ? "is-configured" : "is-local"}`}
      title={label}
      onClick={onClick}
    >
      <span className="sync-pulse" />
      <span className="sync-label">{label}</span>
    </button>
  );
}

function ViewToggle({ view, setView }) {
  return (
    <div className="vt" role="tablist" aria-label="View">
      <button
        className={`vt-btn ${view === "list" ? "is-on" : ""}`}
        role="tab"
        aria-selected={view === "list"}
        onClick={() => setView("list")}
      >
        <IconList />
        <span>List</span>
      </button>
      <button
        className={`vt-btn ${view === "board" ? "is-on" : ""}`}
        role="tab"
        aria-selected={view === "board"}
        onClick={() => setView("board")}
      >
        <IconBoard />
        <span>Board</span>
      </button>
      <span className="vt-slider" data-pos={view} aria-hidden="true" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composer
// ─────────────────────────────────────────────────────────────────────────────
const Composer = React.forwardRef(function Composer({ value, onChange, onSubmit }, ref) {
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <span className="composer-plus" aria-hidden="true">+</span>
      <input
        ref={ref}
        className="composer-input"
        value={value}
        placeholder="What needs doing?"
        onChange={(e) => onChange(e.target.value)}
        aria-label="Add a new item"
      />
    </form>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// List view
// ─────────────────────────────────────────────────────────────────────────────
function ListView({ items, onCycle, onUpdate, onRemove, onReorder, editingId, setEditingId }) {
  // Sorted by time added — newest first.
  const rows = useMemo(
    () => [...items].sort((a, b) => b.createdAt - a.createdAt),
    [items]
  );
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  if (!rows.length) {
    return <div className="list-empty">— nothing here yet —</div>;
  }

  return (
    <div className="list">
      <ul className="rows">
        {rows.map((item, i) => (
          <Row
            key={item.id}
            item={item}
            index={i}
            isEditing={editingId === item.id}
            setEditing={setEditingId}
            onCycle={() => onCycle(item.id)}
            onUpdate={(patch) => onUpdate(item.id, patch)}
            onRemove={() => onRemove(item.id)}
            dragId={dragId}
            setDragId={setDragId}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onDrop={(srcId, pos) => {
              onReorder(srcId, item.id, pos);
              setDragId(null);
              setDropTarget(null);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function SectionHead({ status, count }) {
  return (
    <div className="sec-head">
      <h2 className="sec-title">{STATUS_LABEL[status]}</h2>
      <span className="sec-rule" aria-hidden="true" />
      <span className="sec-count">{String(count).padStart(2, "0")}</span>
    </div>
  );
}

function Row({
  item, index, isEditing, setEditing,
  onCycle, onUpdate, onRemove,
  dragId, setDragId, dropTarget, setDropTarget, onDrop,
}) {
  const isDragging = dragId === item.id;
  const dropAt = dropTarget && dropTarget.id === item.id ? dropTarget.pos : null;

  return (
    <li
      className={`row row-${item.status} ${isDragging ? "is-dragging" : ""} ${dropAt ? `drop-${dropAt}` : ""}`}
      draggable={!isEditing}
      onDragStart={(e) => {
        setDragId(item.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/x-todo-id", item.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
        setDropTarget({ id: item.id, pos });
      }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(e) => {
        e.preventDefault();
        const srcId = e.dataTransfer.getData("text/x-todo-id");
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
        onDrop(srcId || dragId, pos);
      }}
      onDragEnd={() => { setDragId(null); setDropTarget(null); }}
    >
      <span className="row-num" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <Checkbox status={item.status} onClick={onCycle} />
      <ItemTitle
        item={item}
        isEditing={isEditing}
        onStartEdit={() => setEditing(item.id)}
        onCommit={(title) => { onUpdate({ title }); setEditing(null); }}
        onCancel={() => setEditing(null)}
      />
      <span className="row-meta">{relTime(item.createdAt)}</span>
      <button className="row-x" onClick={onRemove} aria-label="Remove">×</button>
    </li>
  );
}

function Checkbox({ status, onClick }) {
  return (
    <button
      className={`cb cb-${status}`}
      onClick={onClick}
      aria-label={`Status: ${STATUS_LABEL[status]}. Click to advance.`}
      title={`${STATUS_LABEL[status]} — click to cycle`}
    >
      {status === "doing" && <span className="cb-half" />}
      {status === "done" && (
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M3 8.5 L7 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function ItemTitle({ item, isEditing, onStartEdit, onCommit, onCancel }) {
  const [draft, setDraft] = useState(item.title);
  useEffect(() => setDraft(item.title), [item.title, isEditing]);

  if (isEditing) {
    return (
      <input
        autoFocus
        className="row-title-edit"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(draft);
          else if (e.key === "Escape") onCancel();
        }}
      />
    );
  }
  return (
    <span
      className={`row-title ${item.status === "done" ? "is-done" : ""}`}
      onClick={onStartEdit}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onStartEdit(); }}
    >
      {item.title}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Board view
// ─────────────────────────────────────────────────────────────────────────────
function BoardView({ items, onCycle, onUpdate, onRemove, onMove, onAdd, editingId, setEditingId }) {
  const cols = useMemo(() => {
    const c = { todo: [], doing: [], done: [] };
    items.forEach((x) => c[x.status].push(x));
    return c;
  }, [items]);

  const [dragId, setDragId] = useState(null);
  const [hoverCol, setHoverCol] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // {id, pos}

  return (
    <div className="board">
      {STATUSES.map((status) => (
        <Column
          key={status}
          status={status}
          items={cols[status]}
          isHover={hoverCol === status}
          setHoverCol={setHoverCol}
          dragId={dragId}
          setDragId={setDragId}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          onCycle={onCycle}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onMove={onMove}
          onAdd={onAdd}
          editingId={editingId}
          setEditingId={setEditingId}
        />
      ))}
    </div>
  );
}

function Column({
  status, items, isHover, setHoverCol,
  dragId, setDragId, dropTarget, setDropTarget,
  onCycle, onUpdate, onRemove, onMove, onAdd,
  editingId, setEditingId,
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <section
      className={`col col-${status} ${isHover ? "is-hover" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setHoverCol(status); }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHoverCol(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const srcId = e.dataTransfer.getData("text/x-todo-id") || dragId;
        const tgt = dropTarget && dropTarget.colStatus === status ? dropTarget : null;
        onMove(srcId, status, tgt?.id, tgt?.pos);
        setDragId(null); setDropTarget(null); setHoverCol(null);
      }}
    >
      <header className="col-head">
        <h2 className="col-title">{STATUS_LABEL[status]}</h2>
        <span className="col-count">{String(items.length).padStart(2, "0")}</span>
      </header>
      <div className="col-rule" />

      <div className="col-body">
        {items.length === 0 && !adding && (
          <div className="col-empty">drop or add</div>
        )}
        {items.map((item) => {
          const dropAt = dropTarget && dropTarget.id === item.id ? dropTarget.pos : null;
          return (
            <Card
              key={item.id}
              item={item}
              dropAt={dropAt}
              isEditing={editingId === item.id}
              setEditing={setEditingId}
              onCycle={() => onCycle(item.id)}
              onUpdate={(patch) => onUpdate(item.id, patch)}
              onRemove={() => onRemove(item.id)}
              onDragStart={(e) => {
                setDragId(item.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/x-todo-id", item.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                setDropTarget({ id: item.id, pos, colStatus: status });
              }}
              onDragEnd={() => { setDragId(null); setDropTarget(null); }}
            />
          );
        })}

        {adding ? (
          <form
            className="card-add"
            onSubmit={(e) => {
              e.preventDefault();
              onAdd(draft, status);
              setDraft("");
              setAdding(false);
            }}
          >
            <input
              autoFocus
              value={draft}
              placeholder="New item"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { if (!draft) setAdding(false); else { onAdd(draft, status); setDraft(""); setAdding(false); } }}
              onKeyDown={(e) => { if (e.key === "Escape") { setDraft(""); setAdding(false); } }}
            />
          </form>
        ) : (
          <button className="col-add" onClick={() => setAdding(true)}>
            <span aria-hidden="true">+</span> add
          </button>
        )}
      </div>
    </section>
  );
}

function Card({ item, dropAt, isEditing, setEditing, onCycle, onUpdate, onRemove, onDragStart, onDragOver, onDragEnd }) {
  return (
    <article
      className={`card card-${item.status} ${dropAt ? `drop-${dropAt}` : ""}`}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="card-top">
        <Checkbox status={item.status} onClick={onCycle} />
        <ItemTitle
          item={item}
          isEditing={isEditing}
          onStartEdit={() => setEditing(item.id)}
          onCommit={(title) => { onUpdate({ title }); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
        <button className="row-x" onClick={onRemove} aria-label="Remove">×</button>
      </div>
      <div className="card-foot">
        <span className="card-time">{relTime(item.createdAt)}</span>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────
function Footnotes({ counts }) {
  const total = counts.todo + counts.doing + counts.done;
  return (
    <footer className="ftr">
      <span>{total} items</span>
      <span className="ftr-sep">·</span>
      <span>{counts.done} done</span>
      <span className="ftr-sep">·</span>
      <span className="ftr-hint">press <kbd>V</kbd> to switch view</span>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function relTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d`;
  const w = Math.round(d / 7);
  return `${w}w`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons (hairline)
// ─────────────────────────────────────────────────────────────────────────────
function IconList() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
function IconBoard() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="2.5" y="3" width="3" height="10" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="6.5" y="3" width="3" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="10.5" y="3" width="3" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

// Defaults — edited via Tweaks.
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": ["#efeae0", "#1a1814", "#a8624a"],
  "density": "regular",
  "serifWordmark": false,
  "showNumbers": true
}/*EDITMODE-END*/;

// Mount
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
