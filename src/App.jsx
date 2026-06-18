import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Papa from "papaparse";
import { ModuleRegistry, AllCommunityModule, themeQuartz } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

ModuleRegistry.registerModules([AllCommunityModule]);
import {
  Upload,
  Play,
  Download,
  Trash2,
  Loader,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Search,
  X,
  Zap,
  RotateCcw,
  Square,
  Copy,
  Filter,
} from "lucide-react";
import "./App.css";

const CONCURRENCY = 3;

const CSV_FIELD_MAP = {
  email: ["email", "e-mail", "correo", "correo electrónico", "mail"],
  nombre: ["nombre", "name", "first name", "firstname"],
  apellidos: ["apellidos", "apellido", "last name", "lastname", "surname"],
  empresa: ["empresa", "company", "compañía", "name", "business"],
  web: ["web", "website", "url", "sitio web", "página web"],
  telefono: ["teléfono", "telefono", "phone", "tel"],
  linkedin: ["linkedin", "linked in", "linkedin url"],
  cargo: ["cargo", "position", "puesto", "job title", "role"],
  ciudad: ["ciudad", "city", "state", "localidad", "población"],
  pais: ["país", "pais", "country"],
  tag: ["tag", "tags", "etiqueta"],
  estado: ["estado", "status"],
  sector: ["sector", "industry", "industria"],
  direccion: ["dirección", "direccion", "address", "domicilio"],
};

function mapHeaders(rawHeaders) {
  const map = {};
  for (const [field, aliases] of Object.entries(CSV_FIELD_MAP)) {
    for (const h of rawHeaders) {
      if (aliases.includes(h.trim().toLowerCase())) {
        map[field] = h;
        break;
      }
    }
  }
  return map;
}

const SPINTAX_VARS = {
  "empresa": "empresaNormalizada",
  "empresa ia": "empresaNormalizada",
  "nombre ia": "empresaNormalizada",
  "nombre": "nombre",
  "apellidos": "apellidos",
  "ciudad": "ciudad",
  "servicio": "servicio",
  "servicio ia": "servicio",
  "detalle": "detalle",
  "email": "email",
  "web": "web",
  "cargo": "cargo",
  "sector": "sector",
  "tag": "tag",
};

function resolveSpintax(text, lead = {}) {
  let result = text.replace(/\{\{(\w[\w\s]*?)\}\}/gi, (_, key) => {
    const field = SPINTAX_VARS[key.toLowerCase().trim()];
    return (field && lead[field]) || key;
  });

  const regex = /\{\{([^{}]+)\}\}/;
  let match;
  while ((match = regex.exec(result)) !== null) {
    const options = match[1].split("|");
    const pick = options[Math.floor(Math.random() * options.length)].trim();
    result = result.slice(0, match.index) + pick + result.slice(match.index + match[0].length);
  }

  const regexSingle = /\{([^{}]+)\}/;
  while ((match = regexSingle.exec(result)) !== null) {
    const options = match[1].split("|");
    const pick = options[Math.floor(Math.random() * options.length)].trim();
    result = result.slice(0, match.index) + pick + result.slice(match.index + match[0].length);
  }

  return result.trim();
}

function extractDomain(url) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

function getDisplayName(lead) {
  if (lead.empresa) return lead.empresa;
  const parts = [lead.nombre, lead.apellidos].filter(Boolean);
  return parts.join(" ") || "Sin nombre";
}

// ─── AG Grid Cell Renderers ───

function StatusCellRenderer({ value }) {
  const cfg = {
    pending: { label: "Pendiente", cls: "chip-pending", icon: Clock },
    processing: { label: "...", cls: "chip-processing", icon: Loader },
    done: { label: "Listo", cls: "chip-done", icon: CheckCircle2 },
    error: { label: "Error", cls: "chip-error", icon: AlertCircle },
  };
  const c = cfg[value] || cfg.pending;
  const Icon = c.icon;
  return (
    <span className={`status-chip ${c.cls}`}>
      <Icon size={11} className={value === "processing" ? "spinner" : ""} />
      {c.label}
    </span>
  );
}

function WebCellRenderer({ value }) {
  if (!value) return "—";
  const href = value.startsWith("http") ? value : `https://${value}`;
  const display = value.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 30);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="cell-link" onClick={(e) => e.stopPropagation()}>
      {display}
    </a>
  );
}

function SerpCellRenderer({ data }) {
  if (data.status !== "done") return null;
  const cls = data.hasRealSerpData ? "serp-real" : "serp-generic";
  return (
    <span className={`serp-chip ${cls}`}>
      {data.hasRealSerpData ? <><Search size={9} /> Real</> : <><Sparkles size={9} /> Gen.</>}
    </span>
  );
}

function IcebreakerCellRenderer({ value, data, context }) {
  return (
    <span className="icebreaker-cell">
      <span className="icebreaker-text">{value || "—"}</span>
      {data.status === "done" && context?.onRegenerate && (
        <button
          className="regen-btn"
          title="Regenerar icebreaker"
          onClick={(e) => { e.stopPropagation(); context.onRegenerate(data); }}
        >
          <RotateCcw size={11} />
        </button>
      )}
    </span>
  );
}

function AplicaCellRenderer({ value, data }) {
  if (data.status !== "done") return null;
  if (value === true) return <span className="aplica-chip aplica-si">Sí</span>;
  if (value === false) return <span className="aplica-chip aplica-no">No</span>;
  return null;
}

function GenericoCellRenderer({ value, data }) {
  if (data.status !== "done") return null;
  if (value === true) return <span className="aplica-chip aplica-no">Genérico</span>;
  if (value === false) return <span className="aplica-chip aplica-si">IA</span>;
  return null;
}

// ─── Column Definitions ───

const COLUMN_DEFS = [
  { headerName: "", checkboxSelection: true, headerCheckboxSelection: true, width: 40, pinned: "left", suppressNavigable: true, lockPosition: true, sortable: false, resizable: false, editable: false },
  { headerName: "#", valueGetter: "node.rowIndex + 1", width: 50, pinned: "left", suppressNavigable: true, cellClass: "cell-row-num", editable: false },
  { headerName: "Estado", field: "status", width: 90, cellRenderer: StatusCellRenderer, editable: false },
  { headerName: "Email", field: "email", width: 200 },
  { headerName: "Nombre", field: "nombre", width: 120 },
  { headerName: "Apellidos", field: "apellidos", width: 120 },
  { headerName: "Empresa", field: "empresa", width: 160, cellClass: "cell-bold" },
  { headerName: "Web", field: "web", width: 180, cellRenderer: WebCellRenderer, editable: false },
  { headerName: "Ciudad", field: "ciudad", width: 120 },
  { headerName: "Cargo", field: "cargo", width: 120 },
  { headerName: "Sector", field: "sector", width: 120 },
  { headerName: "Teléfono", field: "telefono", width: 120 },
  { headerName: "Tag", field: "tag", width: 120 },
  { headerName: "Nombre IA", field: "empresaNormalizada", width: 160, cellClass: "cell-company", headerClass: "header-enriched" },
  { headerName: "Servicio IA", field: "servicio", width: 170, cellClass: "cell-service", headerClass: "header-enriched" },
  { headerName: "Detalle IA", field: "detalle", width: 200, cellClass: "cell-service", headerClass: "header-enriched" },
  { headerName: "SERP", field: "hasRealSerpData", width: 80, cellRenderer: SerpCellRenderer, headerClass: "header-enriched", editable: false },
  {
    headerName: "Pág. Google", field: "leadPosition", width: 100, headerClass: "header-enriched", editable: false,
    valueFormatter: (p) => {
      if (p.data?.status !== "done") return "";
      if (p.value >= 1 && p.value <= 10) return "Página 1";
      if (p.value > 10) return `Página ${Math.ceil(p.value / 10)}`;
      return "No aparece";
    },
  },
  { headerName: "Aplica", field: "aplica", width: 80, cellRenderer: AplicaCellRenderer, headerClass: "header-enriched", editable: false },
  { headerName: "Genérico", field: "generico", width: 90, cellRenderer: GenericoCellRenderer, headerClass: "header-enriched", editable: false },
  { headerName: "Icebreaker", field: "icebreaker", width: 350, cellRenderer: IcebreakerCellRenderer, headerClass: "header-enriched", autoHeight: true, wrapText: true },
];

const DEFAULT_COL_DEF = {
  resizable: true,
  sortable: true,
  suppressMovable: false,
  editable: true,
};

// ─── Main App ───

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function App() {
  const [leads, setLeadsRaw] = useState(() => loadFromStorage("prospector_leads", []));
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: "" });
  const [shouldAutoStart, setShouldAutoStart] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [processLimit, setProcessLimit] = useState(10);
  const [showLimitPicker, setShowLimitPicker] = useState(false);
  const [filterAplica, setFilterAplica] = useState(false);
  const [filterDone, setFilterDone] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [spintaxText, setSpintaxText] = useState(() => loadFromStorage("prospector_spintax", ""));
  const [showSpintaxEditor, setShowSpintaxEditor] = useState(false);

  const setLeads = useCallback((updater) => {
    setLeadsRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try {
        const toSave = next.map(({ serpResults, ...rest }) => rest);
        localStorage.setItem("prospector_leads", JSON.stringify(toSave));
      } catch (e) {
        console.warn("[storage] No se pudo guardar:", e.message);
      }
      return next;
    });
  }, []);
  const fileInputRef = useRef(null);
  const excludeInputRef = useRef(null);
  const abortRef = useRef(false);
  const logEndRef = useRef(null);
  const logUserScrolling = useRef(false);
  const logContainerRef = useRef(null);
  const gridRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("prospector_spintax", JSON.stringify(spintaxText)); } catch {}
  }, [spintaxText]);

  // ─── Batched update system ───
  const pendingLeadUpdatesRef = useRef(new Map());
  const pendingLogsRef = useRef([]);
  const progressRef = useRef({ current: 0, total: 0, phase: "" });
  const flushScheduledRef = useRef(false);

  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    requestAnimationFrame(() => {
      flushScheduledRef.current = false;

      const leadUpdates = pendingLeadUpdatesRef.current;
      if (leadUpdates.size > 0) {
        const snapshot = new Map(leadUpdates);
        leadUpdates.clear();
        setLeads((prev) =>
          prev.map((l) => {
            const fields = snapshot.get(l.id);
            return fields ? { ...l, ...fields } : l;
          })
        );
      }

      const newLogs = pendingLogsRef.current;
      if (newLogs.length > 0) {
        pendingLogsRef.current = [];
        setLogs((prev) => [...prev, ...newLogs].slice(-300));
      }

      setProgress({ ...progressRef.current });
    });
  }, []);

  const updateLead = useCallback(
    (leadId, fields) => {
      const existing = pendingLeadUpdatesRef.current.get(leadId);
      pendingLeadUpdatesRef.current.set(leadId, existing ? { ...existing, ...fields } : fields);
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const addLog = useCallback(
    (msg, type = "info") => {
      const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      pendingLogsRef.current.push({ time, msg, type });
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const updateProgress = useCallback(
    (fields) => {
      Object.assign(progressRef.current, fields);
      scheduleFlush();
    },
    [scheduleFlush]
  );

  useEffect(() => {
    if (!logUserScrolling.current && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (shouldAutoStart && leads.length > 0 && !processing) {
      setShouldAutoStart(false);
      setShowLimitPicker(true);
    }
  }, [shouldAutoStart, leads, processing]);

  const handleFileUpload = (file) => {
    if (!file || (!file.name.endsWith(".csv") && !file.name.endsWith(".CSV"))) {
      addLog("El archivo debe ser un CSV", "error");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: "UTF-8",
      complete: (results) => {
        const rawHeaders = results.meta.fields || [];
        const hMap = mapHeaders(rawHeaders);
        const get = (row, field) => {
          const key = hMap[field];
          return key ? (row[key] || "").trim() : "";
        };

        const parsed = results.data
          .filter((row) => get(row, "empresa") || get(row, "email") || get(row, "nombre"))
          .map((row, idx) => ({
            id: idx,
            email: get(row, "email"),
            nombre: get(row, "nombre"),
            apellidos: get(row, "apellidos"),
            empresa: get(row, "empresa"),
            web: get(row, "web"),
            telefono: get(row, "telefono"),
            linkedin: get(row, "linkedin"),
            cargo: get(row, "cargo"),
            ciudad: get(row, "ciudad"),
            pais: get(row, "pais"),
            tag: get(row, "tag"),
            estadoOriginal: get(row, "estado"),
            sector: get(row, "sector"),
            direccion: get(row, "direccion"),
            empresaNormalizada: "",
            servicio: "",
            detalle: "",
            generico: null,
            icebreaker: "",
            serpResults: null,
            serpQuery: "",
            hasRealSerpData: false,
            leadPosition: -1,
            aplica: null,
            status: "pending",
            error: "",
          }));

        if (parsed.length === 0) {
          addLog(`CSV vacío o columnas no reconocidas. Detectadas: ${rawHeaders.join(", ")}`, "error");
          return;
        }

        setLeads(parsed);
        setLogs([]);
        addLog(`CSV cargado: ${parsed.length} leads. Columnas mapeadas: ${Object.keys(hMap).join(", ")}`, "success");
        addLog("Iniciando enriquecimiento automático...", "info");
        setShouldAutoStart(true);
      },
      error: (err) => {
        addLog(`Error al parsear CSV: ${err.message}`, "error");
      },
    });
  };

  const callApi = async (endpoint, body) => {
    const res = await fetch(`/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${endpoint} (${res.status}): ${text.slice(0, 200)}`);
    }
    return res.json();
  };

  const processLead = async (lead, index) => {
    if (abortRef.current) return;
    const displayName = getDisplayName(lead);

    try {
      updateLead(lead.id, { status: "processing" });
      addLog(`[${index + 1}] Normalizando: ${displayName}`);
      updateProgress({ phase: "Normalizando nombre" });
      const { companyName } = await callApi("normalize-name", { name: displayName });
      updateLead(lead.id, { empresaNormalizada: companyName });
      addLog(`[${index + 1}] → ${companyName}`, "success");

      if (abortRef.current) return;
      addLog(`[${index + 1}] Analizando web: ${lead.web || "sin web"}`);
      updateProgress({ phase: "Scraping web" });
      const serviceData = await callApi("extract-service", { website: lead.web });
      const servicio = serviceData.servicio;
      const detalle = serviceData.detalle || null;
      updateLead(lead.id, { servicio, detalle: detalle || "" });
      addLog(`[${index + 1}] Servicio: ${servicio}${detalle ? ` | Detalle: ${detalle}` : ""}`, "success");

      if (abortRef.current) return;
      let serpResults = null;
      let serpQuery = "";
      const servicioLower = (servicio || "").toLowerCase();
      const isServiceValid = servicio && servicio.length >= 3
        && !["su servicio principal", "servicio principal", "tu servicio", "vuestro servicio principal"]
          .some((p) => servicioLower.includes(p));

      if (lead.ciudad && isServiceValid) {
        addLog(`[${index + 1}] Google: "${servicio} en ${lead.ciudad}"`);
        updateProgress({ phase: "Google SERP" });
        try {
          const serpData = await callApi("serp-search", { keyword: servicio, city: lead.ciudad });
          serpResults = serpData.results;
          serpQuery = serpData.query;
          const pages = Math.ceil(serpResults.length / 10);
          addLog(`[${index + 1}] SERP: ${serpResults.length} resultados (${pages} página${pages > 1 ? "s" : ""})`, "success");
        } catch (e) {
          addLog(`[${index + 1}] SERP fallido: ${e.message}`, "error");
        }
      }

      if (!isServiceValid || !serpResults) {
        const reason = !isServiceValid ? "servicio no extraído" : "sin datos SERP";
        if (spintaxText.trim()) {
          const leadData = { ...lead, empresaNormalizada: companyName, servicio, detalle };
          const genericIcebreaker = resolveSpintax(spintaxText, leadData);
          addLog(`[${index + 1}] ${companyName} → Icebreaker genérico (${reason})`, "info");
          updateLead(lead.id, {
            serpResults, serpQuery, hasRealSerpData: false,
            leadPosition: -1, aplica: true, generico: true,
            icebreaker: genericIcebreaker,
            status: "done", error: "",
          });
        } else {
          addLog(`[${index + 1}] ⚡ ${companyName} → No aplica: ${reason} (sin spintax configurado)`, "info");
          updateLead(lead.id, {
            serpResults, serpQuery, hasRealSerpData: false,
            leadPosition: -1, aplica: false, generico: null,
            icebreaker: `No aplica: ${reason}`,
            status: "done", error: "",
          });
        }
        progressRef.current.current += 1;
        scheduleFlush();
        return;
      }

      if (abortRef.current) return;
      addLog(`[${index + 1}] Buscando posición en Google y generando icebreaker...`);
      updateProgress({ phase: "Posición + Icebreaker" });
      const ibData = await callApi("generate-icebreaker", {
        companyName, city: lead.ciudad, servicio, serpResults,
        website: lead.web, email: lead.email, detalle,
      });

      const pos = ibData.leadPosition ?? -1;

      if (ibData.skipped) {
        const reason = ibData.skipReason || "ya posicionado";
        addLog(`[${index + 1}] ⚡ ${companyName} → No aplica: ${reason}`, "info");
        updateLead(lead.id, {
          serpResults, serpQuery, hasRealSerpData: ibData.hasRealSerpData ?? true,
          leadPosition: pos, aplica: false, generico: null,
          icebreaker: reason === "ya en primera página" ? `Ya posicionado en #${pos} de Google` : `No aplica: ${reason}`,
          status: "done", error: "",
        });
      } else {
        const posInfo = pos > 10 ? ` → pos. ${pos} (pág. ${Math.ceil(pos / 10)})` : pos === -1 ? " → no aparece en Google" : "";
        const reviewFlag = ibData.needsReview ? " ⚠️ REVISAR (tuteo)" : "";
        addLog(`[${index + 1}] Completado: ${companyName}${posInfo}${reviewFlag}`, ibData.needsReview ? "error" : "success");
        updateLead(lead.id, {
          icebreaker: ibData.icebreaker, serpResults, serpQuery,
          hasRealSerpData: ibData.hasRealSerpData,
          leadPosition: pos, aplica: true, generico: false,
          status: "done", error: ibData.needsReview ? "Revisar: posible tuteo" : "",
        });
      }
    } catch (err) {
      updateLead(lead.id, { status: "error", error: err.message });
      addLog(`[${index + 1}] Error: ${err.message}`, "error");
    }

    progressRef.current.current += 1;
    scheduleFlush();
  };

  const regenerateSingleIcebreaker = useCallback(async (lead) => {
    const displayName = getDisplayName(lead);
    const companyName = lead.empresaNormalizada || displayName;
    const servicio = lead.servicio;
    const detalle = lead.detalle || null;

    updateLead(lead.id, { status: "processing", icebreaker: "", generico: null });
    addLog(`Regenerando icebreaker: ${companyName}`);

    const servicioLower = (servicio || "").toLowerCase();
    const isServiceValid = servicio && servicio.length >= 3
      && !["su servicio principal", "servicio principal", "tu servicio", "vuestro servicio principal"]
        .some((p) => servicioLower.includes(p));

    if (!isServiceValid || !lead.serpResults) {
      if (spintaxText.trim()) {
        const leadData = { ...lead, empresaNormalizada: companyName, servicio, detalle };
        const genericIcebreaker = resolveSpintax(spintaxText, leadData);
        updateLead(lead.id, { icebreaker: genericIcebreaker, generico: true, aplica: true, status: "done", error: "" });
        addLog(`${companyName} → Icebreaker genérico regenerado`, "info");
      } else {
        updateLead(lead.id, { icebreaker: "No aplica: servicio no extraído", generico: null, aplica: false, status: "done", error: "" });
        addLog(`${companyName} → Sin spintax, no se puede regenerar`, "error");
      }
      return;
    }

    try {
      const ibData = await callApi("generate-icebreaker", {
        companyName, city: lead.ciudad, servicio,
        serpResults: lead.serpResults,
        website: lead.web, email: lead.email, detalle,
      });

      if (ibData.skipped) {
        updateLead(lead.id, {
          icebreaker: `Ya posicionado en #${ibData.leadPosition} de Google`,
          aplica: false, generico: null, status: "done", error: "",
        });
      } else {
        updateLead(lead.id, {
          icebreaker: ibData.icebreaker, generico: false, aplica: true,
          status: "done", error: ibData.needsReview ? "Revisar: posible tuteo" : "",
        });
      }
      addLog(`${companyName} → Icebreaker regenerado`, "success");
    } catch (err) {
      updateLead(lead.id, { status: "error", error: err.message });
      addLog(`${companyName} → Error: ${err.message}`, "error");
    }
  }, [updateLead, addLog, callApi, spintaxText]);

  const regenerateSelected = useCallback(async () => {
    const api = gridRef.current?.api;
    if (!api) return;
    const selectedRows = api.getSelectedRows();
    if (selectedRows.length === 0) {
      addLog("No hay filas seleccionadas para regenerar", "error");
      return;
    }
    setProcessing(true);
    addLog(`Regenerando ${selectedRows.length} icebreakers...`, "info");
    progressRef.current = { current: 0, total: selectedRows.length, phase: "Regenerando" };
    setProgress({ ...progressRef.current });

    const queue = [...selectedRows];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0 && !abortRef.current) {
        const lead = queue.shift();
        if (lead) {
          await regenerateSingleIcebreaker(lead);
          progressRef.current.current += 1;
          scheduleFlush();
        }
      }
    });
    await Promise.all(workers);
    setProcessing(false);
    addLog(`Regeneración completada (${selectedRows.length} leads)`, "success");
  }, [regenerateSingleIcebreaker, addLog, scheduleFlush]);

  const processSelected = useCallback(async () => {
    const api = gridRef.current?.api;
    if (!api) return;
    const selectedRows = api.getSelectedRows();
    if (selectedRows.length === 0) {
      addLog("No hay filas seleccionadas para procesar", "error");
      return;
    }

    abortRef.current = false;
    setProcessing(true);
    const toProcess = selectedRows.filter((l) => l.status === "pending" || l.status === "error");
    if (toProcess.length === 0) {
      addLog("Todas las filas seleccionadas ya están procesadas. Usa 'Regenerar' para reprocesarlas.", "info");
      setProcessing(false);
      return;
    }

    progressRef.current = { current: 0, total: toProcess.length, phase: "Iniciando..." };
    setProgress({ ...progressRef.current });
    addLog(`Procesando ${toProcess.length} leads seleccionados (${CONCURRENCY} en paralelo)`, "info");

    const queue = [...toProcess];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0 && !abortRef.current) {
        const lead = queue.shift();
        if (lead) {
          const idx = leads.findIndex((l) => l.id === lead.id);
          await processLead(lead, idx);
        }
      }
    });
    await Promise.all(workers);
    setProcessing(false);
    addLog(`Procesamiento de selección completado`, "success");
  }, [leads, addLog, processLead]);

  const onCellValueChanged = useCallback((event) => {
    const field = event.colDef.field;
    if (field && event.data) {
      setLeads((prev) => prev.map((l) =>
        l.id === event.data.id ? { ...l, [field]: event.newValue } : l
      ));
    }
  }, []);

  const getVisibleLeadOrder = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return leads;
    const ordered = [];
    api.forEachNodeAfterFilterAndSort((node) => {
      if (node.data) ordered.push(node.data);
    });
    return ordered.length > 0 ? ordered : leads;
  }, [leads]);

  const startProcessing = async (limit) => {
    abortRef.current = false;
    setProcessing(true);
    setShowLimitPicker(false);

    const visibleOrder = getVisibleLeadOrder();
    const allPending = visibleOrder.filter((l) => l.status === "pending" || l.status === "error");
    const effectiveLimit = limit || processLimit;
    const toProcess = effectiveLimit === 0 ? allPending : allPending.slice(0, effectiveLimit);

    progressRef.current = { current: 0, total: toProcess.length, phase: "Iniciando..." };
    setProgress({ ...progressRef.current });
    addLog(`Procesando ${toProcess.length} de ${allPending.length} leads pendientes (${CONCURRENCY} en paralelo)`, "info");

    const queue = [...toProcess];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0 && !abortRef.current) {
        const lead = queue.shift();
        if (lead) {
          const idx = leads.findIndex((l) => l.id === lead.id);
          await processLead(lead, idx);
        }
      }
    });

    await Promise.all(workers);
    setProcessing(false);

    const remaining = leads.filter((l) => l.status === "pending").length - toProcess.length;
    if (abortRef.current) {
      addLog("Detenido por el usuario", "error");
    } else if (remaining > 0) {
      addLog(`Lote completado. Quedan ${remaining} leads pendientes.`, "success");
    } else {
      addLog("Procesamiento completado!", "success");
    }
  };

  const downloadCSV = () => {
    let source = leads;
    if (filterAplica) source = source.filter((l) => l.aplica !== false);
    if (filterDone) source = source.filter((l) => l.status === "done" && l.icebreaker);
    const rows = source.map((l) => ({
      Estado: l.status,
      Email: l.email,
      Nombre: l.nombre,
      Apellidos: l.apellidos,
      Empresa: l.empresa,
      "Empresa Normalizada": l.empresaNormalizada,
      Web: l.web,
      "Teléfono": l.telefono,
      LinkedIn: l.linkedin,
      Cargo: l.cargo,
      Ciudad: l.ciudad,
      "País": l.pais,
      Tag: l.tag,
      "Estado Original": l.estadoOriginal || "",
      Sector: l.sector,
      "Dirección": l.direccion,
      "Servicio Detectado": l.servicio,
      "Detalle Diferenciador": l.detalle || "",
      "SERP Real": l.hasRealSerpData ? "Sí" : "No",
      "Búsqueda Google": l.serpQuery,
      "Posición Google": l.leadPosition > 0 ? l.leadPosition : "No aparece",
      "Página Google": l.leadPosition > 0 ? `Página ${Math.ceil(l.leadPosition / 10)}` : "No aparece",
      Aplica: l.aplica === true ? "Sí" : l.aplica === false ? "No" : "",
      "Genérico": l.generico === true ? "Sí" : l.generico === false ? "No" : "",
      Icebreaker: l.icebreaker,
      Error: l.error || "",
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_enriquecidos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("CSV descargado", "success");
  };

  const stats = useMemo(() => ({
    total: leads.length,
    done: leads.filter((l) => l.status === "done").length,
    processing: leads.filter((l) => l.status === "processing").length,
    errors: leads.filter((l) => l.status === "error").length,
    serp: leads.filter((l) => l.hasRealSerpData).length,
    aplican: leads.filter((l) => l.aplica === true).length,
    noAplican: leads.filter((l) => l.aplica === false).length,
  }), [leads]);

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const filteredLeads = useMemo(() => {
    let result = leads;
    if (filterAplica) result = result.filter((l) => l.aplica !== false);
    if (filterDone) result = result.filter((l) => l.status === "done" && l.icebreaker);
    return result;
  }, [leads, filterAplica, filterDone]);

  const deleteSelected = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const selectedIds = new Set(api.getSelectedRows().map((r) => r.id));
    if (selectedIds.size === 0) return;
    setLeads((prev) => prev.filter((l) => !selectedIds.has(l.id)));
    setSelectedCount(0);
    addLog(`${selectedIds.size} leads eliminados`, "success");
  }, [addLog]);

  const handleExcludeCSV = useCallback((file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const emailCol = results.meta.fields?.find((f) => f.toLowerCase().includes("email"));
        if (!emailCol) {
          addLog("CSV de exclusión: no se encontró columna de email", "error");
          return;
        }
        const excludeEmails = new Set(
          results.data.map((r) => (r[emailCol] || "").trim().toLowerCase()).filter(Boolean)
        );
        const before = leads.length;
        setLeads((prev) => prev.filter((l) => !excludeEmails.has((l.email || "").toLowerCase())));
        const removed = before - leads.length + excludeEmails.size;
        addLog(`CSV de exclusión cargado: ${excludeEmails.size} emails. Leads eliminados del listado.`, "success");
      },
    });
  }, [leads, addLog]);

  const onRowClicked = useCallback(() => {}, []);

  const getRowClass = useCallback((params) => {
    if (params.data?.status === "processing") return "ag-row-processing";
    if (params.data?.status === "done") return "ag-row-done";
    if (params.data?.status === "error") return "ag-row-error";
    return "";
  }, []);

  // ─── Upload screen ───
  if (leads.length === 0) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="topbar-logo"><Search size={16} /></div>
          <span className="topbar-title">Prospector</span>
        </div>
        <div
          className="upload-overlay"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFileUpload(e.dataTransfer.files[0]); }}
        >
          <div className={`upload-box ${dragging ? "dragging" : ""}`} onClick={() => fileInputRef.current?.click()}>
            <div className="upload-icon"><Upload size={28} /></div>
            <h3>Sube tu CSV de leads</h3>
            <p>Arrastra y suelta o <span className="highlight">haz clic para seleccionar</span></p>
            <input ref={fileInputRef} type="file" accept=".csv,.CSV" style={{ display: "none" }} onChange={(e) => handleFileUpload(e.target.files[0])} />
          </div>
        </div>
        {logs.length > 0 && (
          <div className="log-drawer">
            {logs.map((l, i) => (
              <div key={i} className="log-row">
                <span className="log-time">{l.time}</span>
                <span className={`log-msg ${l.type}`}>{l.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Main grid view ───
  return (
    <div className="app">
      <div className="topbar">
          <div className="topbar-logo"><Search size={16} /></div>
          <span className="topbar-title">Prospector</span>
          <div className="topbar-divider" />
          <div className="topbar-stats">
            <span className="topbar-stat"><span className="dot dot-total" />{stats.total} leads</span>
            <span className="topbar-stat"><span className="dot dot-done" />{stats.done} listos</span>
            {stats.processing > 0 && <span className="topbar-stat"><span className="dot dot-processing" />{stats.processing} procesando</span>}
            {stats.serp > 0 && <span className="topbar-stat"><span className="dot dot-serp" />{stats.serp} con SERP real</span>}
            {stats.errors > 0 && <span className="topbar-stat"><span className="dot dot-error" />{stats.errors} errores</span>}
          </div>
          <div className="topbar-actions">
            {processing && <span style={{ fontSize: "0.72rem", color: "var(--accent)" }}><Loader size={12} className="spinner" style={{ verticalAlign: "middle", marginRight: 4 }} />{progress.phase} — {pct}%</span>}
          </div>
        </div>

        <div className="toolbar">
          {!processing ? (
            <>
              <button className="toolbar-btn primary" onClick={() => setShowLimitPicker(true)} disabled={stats.done === stats.total && stats.errors === 0}>
                <Play size={13} /> {stats.done > 0 ? "Continuar" : "Enriquecer"}
              </button>
              <button className="toolbar-btn" onClick={processSelected} title="Procesar solo las filas seleccionadas">
                <Play size={13} /> Procesar selección
              </button>
              <button className="toolbar-btn" onClick={regenerateSelected} title="Regenerar icebreaker en filas seleccionadas">
                <RotateCcw size={13} /> Regenerar selección
              </button>
              {stats.done > 0 && (
                <button className="toolbar-btn success" onClick={downloadCSV}><Download size={13} /> Descargar CSV</button>
              )}
              <div className="toolbar-separator" />
              <button className="toolbar-btn" onClick={() => setLeads((prev) => prev.map((l) => ({ ...l, empresaNormalizada: "", servicio: "", detalle: "", generico: null, icebreaker: "", serpResults: null, serpQuery: "", hasRealSerpData: false, leadPosition: -1, aplica: null, status: "pending", error: "" })))}>
                <RotateCcw size={13} /> Resetear
              </button>
              <button className="toolbar-btn danger" onClick={() => { setLeads([]); setLogs([]); setProgress({ current: 0, total: 0, phase: "" }); localStorage.removeItem("prospector_leads"); }}>
                <Trash2 size={13} /> Borrar
              </button>
              <button className="toolbar-btn" onClick={() => excludeInputRef.current?.click()}>
                <X size={13} /> Excluir CSV
              </button>
              <input ref={excludeInputRef} type="file" accept=".csv,.CSV" style={{ display: "none" }} onChange={(e) => { handleExcludeCSV(e.target.files[0]); e.target.value = ""; }} />
            </>
          ) : (
            <button className="toolbar-btn danger" onClick={() => { abortRef.current = true; }}><X size={13} /> Detener</button>
          )}
          {selectedCount > 0 && (
            <>
              <div className="toolbar-separator" />
              <span className="toolbar-badge-selected">{selectedCount} seleccionados</span>
              {!processing && (
                <button className="toolbar-btn danger" onClick={deleteSelected}>
                  <Trash2 size={13} /> Eliminar selección
                </button>
              )}
            </>
          )}
          <div className="toolbar-separator" />
          <label className="toolbar-checkbox">
            <input type="checkbox" checked={filterAplica} onChange={(e) => setFilterAplica(e.target.checked)} />
            <Filter size={13} /> Solo aplican {stats.aplican > 0 && <span className="toolbar-badge">{stats.aplican}</span>}
          </label>
          <label className="toolbar-checkbox">
            <input type="checkbox" checked={filterDone} onChange={(e) => setFilterDone(e.target.checked)} />
            <CheckCircle2 size={13} /> Con icebreaker {stats.done > 0 && <span className="toolbar-badge">{stats.done}</span>}
          </label>
          <div className="toolbar-separator" />
          <button className={`toolbar-btn ${spintaxText ? "success" : ""}`} onClick={() => setShowSpintaxEditor(true)}>
            <Sparkles size={13} /> Spintax {spintaxText ? "✓" : ""}
          </button>
          <div className="toolbar-separator" />
          <button className="toolbar-btn" onClick={() => setShowLogs((v) => !v)}>
            <Square size={13} /> {showLogs ? "Ocultar log" : "Ver log"}
          </button>
        </div>

        {(processing || progress.total > 0) && (
          <div className="progress-strip"><div className="progress-strip-fill" style={{ width: `${pct}%` }} /></div>
        )}

        <div className="grid-wrapper" style={{ height: "calc(100vh - 180px)", width: "100%" }}>
          <AgGridReact
            ref={gridRef}
            theme={themeQuartz}
            rowData={filteredLeads}
            columnDefs={COLUMN_DEFS}
            defaultColDef={DEFAULT_COL_DEF}
            getRowId={(params) => String(params.data.id)}
            onRowClicked={onRowClicked}
            getRowClass={getRowClass}
            animateRows={false}
            rowHeight={36}
            headerHeight={34}
            suppressCellFocus={false}
            enableCellTextSelection={true}
            rowSelection="multiple"
            suppressRowClickSelection={true}
            context={{ onRegenerate: regenerateSingleIcebreaker }}
            onCellValueChanged={onCellValueChanged}
            onSelectionChanged={(e) => setSelectedCount(e.api.getSelectedRows().length)}
          />
        </div>

        {showLogs && logs.length > 0 && (
          <div className="log-drawer" ref={logContainerRef}
            onScroll={() => {
              const el = logContainerRef.current;
              if (!el) return;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
              logUserScrolling.current = !atBottom;
            }}
          >
            {logs.map((l, i) => (
              <div key={i} className="log-row">
                <span className="log-time">{l.time}</span>
                <span className={`log-msg ${l.type}`}>{l.msg}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {showSpintaxEditor && (
          <>
            <div className="detail-panel-overlay" onClick={() => setShowSpintaxEditor(false)} />
            <div className="limit-picker-modal" style={{ maxWidth: 600 }}>
              <h3><Sparkles size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />Párrafo genérico con Spintax</h3>
              <p className="limit-picker-desc">
                Escribe tu párrafo genérico con spintax. Se usará para leads donde no se pueda extraer el servicio.
                Usa <code>{"{opción1|opción2|opción3}"}</code> para variaciones.
              </p>
              <textarea
                className="spintax-textarea"
                rows={6}
                value={spintaxText}
                onChange={(e) => setSpintaxText(e.target.value)}
                placeholder={"{Hola|Buenos días}, he estado {mirando|revisando} vuestra web y {me ha llamado la atención|me ha parecido interesante} lo que ofrecéis."}
              />
              {spintaxText && (
                <div className="spintax-preview">
                  <div className="detail-label" style={{ marginBottom: 4 }}>Vista previa (una variación):</div>
                  <div className="detail-value" style={{ fontSize: "0.85rem", fontStyle: "italic" }}>{resolveSpintax(spintaxText)}</div>
                </div>
              )}
              <div className="limit-picker-actions">
                <button className="toolbar-btn danger" onClick={() => { setSpintaxText(""); setShowSpintaxEditor(false); }}>Borrar spintax</button>
                {spintaxText && (() => {
                  const sinServicio = leads.filter((l) => l.status === "done" && (!l.servicio || l.servicio.length < 3 || ["su servicio principal", "servicio principal"].some((p) => (l.servicio || "").toLowerCase().includes(p))));
                  return sinServicio.length > 0 ? (
                    <button className="toolbar-btn" onClick={() => {
                      sinServicio.forEach((l) => {
                        const leadData = { ...l };
                        const ib = resolveSpintax(spintaxText, leadData);
                        updateLead(l.id, { icebreaker: ib, generico: true, aplica: true });
                      });
                      addLog(`Spintax aplicado a ${sinServicio.length} leads sin servicio`, "success");
                      setShowSpintaxEditor(false);
                    }}>
                      <Sparkles size={13} /> Aplicar a {sinServicio.length} sin servicio
                    </button>
                  ) : null;
                })()}
                <button className="toolbar-btn primary" onClick={() => setShowSpintaxEditor(false)}>Guardar</button>
              </div>
            </div>
          </>
        )}

        {showLimitPicker && (
          <>
            <div className="detail-panel-overlay" onClick={() => setShowLimitPicker(false)} />
            <div className="limit-picker-modal">
              <h3>Cuántos leads procesar?</h3>
              <p className="limit-picker-desc">CSV cargado con <strong>{leads.length}</strong> leads. Elige cuántos quieres enriquecer ahora.</p>
              <div className="limit-picker-options">
                {[5, 10, 25, 50, 100].map((n) => (
                  <button key={n} className={`limit-option ${processLimit === n ? "active" : ""}`} onClick={() => setProcessLimit(n)}>{n}</button>
                ))}
                <button className={`limit-option ${processLimit === 0 ? "active" : ""}`} onClick={() => setProcessLimit(0)}>
                  Todos ({leads.filter((l) => l.status === "pending" || l.status === "error").length})
                </button>
              </div>
              <div className="limit-picker-custom">
                <label>O introduce un número:</label>
                <input type="number" min="1" max={leads.length} value={processLimit || ""} onChange={(e) => setProcessLimit(parseInt(e.target.value) || 0)} placeholder="Ej: 20" />
              </div>
              <div className="limit-picker-actions">
                <button className="toolbar-btn" onClick={() => setShowLimitPicker(false)}>Cancelar</button>
                <button className="toolbar-btn primary" onClick={() => startProcessing(processLimit)}>
                  <Play size={13} /> Procesar {processLimit === 0 ? "todos" : processLimit} leads
                </button>
              </div>
            </div>
          </>
        )}

        {selectedLead && (
          <>
            <div className="detail-panel-overlay" onClick={() => setSelectedLead(null)} />
            <div className="detail-panel">
              <div className="detail-panel-header">
                <h2><Sparkles size={18} style={{ color: "var(--accent)" }} />{selectedLead.empresaNormalizada || getDisplayName(selectedLead)}</h2>
                <button className="detail-close" onClick={() => setSelectedLead(null)}><X size={18} /></button>
              </div>
              <div className="detail-grid">
                <div className="detail-section"><div className="detail-label">Email</div><div className="detail-value">{selectedLead.email || "—"}</div></div>
                <div className="detail-section"><div className="detail-label">Ciudad</div><div className="detail-value">{selectedLead.ciudad || "—"}</div></div>
                <div className="detail-section"><div className="detail-label">Empresa original</div><div className="detail-value">{selectedLead.empresa || "—"}</div></div>
                <div className="detail-section"><div className="detail-label">Cargo</div><div className="detail-value">{selectedLead.cargo || "—"}</div></div>
              </div>
              <div className="detail-section"><div className="detail-label">Nombre normalizado (IA)</div><div className="detail-value accent">{selectedLead.empresaNormalizada}</div></div>
              <div className="detail-section"><div className="detail-label">Servicio detectado (scraping web)</div><div className="detail-value yellow">{selectedLead.servicio}</div></div>
              {selectedLead.detalle && <div className="detail-section"><div className="detail-label">Detalle diferenciador (IA)</div><div className="detail-value accent">{selectedLead.detalle}</div></div>}
              {selectedLead.serpResults?.length > 0 && (
                <div className="detail-section">
                  <div className="detail-label"><Search size={11} style={{ verticalAlign: "middle" }} /> Google: "{selectedLead.serpQuery}"</div>
                  {selectedLead.serpResults.map((r, i) => {
                    const isLead = selectedLead.web && r.url?.toLowerCase().includes(extractDomain(selectedLead.web).toLowerCase());
                    return (
                      <div key={i} className="serp-result-item">
                        <div className={`serp-pos ${isLead ? "is-lead" : ""}`}>{r.position}</div>
                        <div className="serp-detail">
                          <div className="title">{r.title}{isLead && <span style={{ marginLeft: 6, color: "var(--green)", fontSize: "0.66rem" }}>TU LEAD</span>}</div>
                          <div className="domain">{r.domain || r.url}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="detail-section">
                <div className="detail-label">Icebreaker generado</div>
                <div className="detail-value" style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>{selectedLead.icebreaker}</div>
                {selectedLead.hasRealSerpData && (
                  <div style={{ marginTop: 6 }}><span className="serp-chip serp-real"><Search size={9} /> Basado en datos reales de Google</span></div>
                )}
              </div>
              <div className="detail-actions">
                <button className="toolbar-btn primary" onClick={() => { navigator.clipboard.writeText(selectedLead.icebreaker); addLog("Icebreaker copiado", "success"); }}>
                  <Copy size={13} /> Copiar icebreaker
                </button>
                <button className="toolbar-btn" onClick={() => setSelectedLead(null)}>Cerrar</button>
              </div>
            </div>
          </>
        )}
      </div>
  );
}

export default App;
