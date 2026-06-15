import { useState, useRef, useCallback, useEffect } from "react";
import Papa from "papaparse";
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
  Eye,
  X,
  Zap,
  RotateCcw,
  Square,
  Copy,
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

function App() {
  const [leads, setLeads] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: "" });
  const [shouldAutoStart, setShouldAutoStart] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const fileInputRef = useRef(null);
  const abortRef = useRef(false);
  const logEndRef = useRef(null);

  const addLog = useCallback((msg, type = "info") => {
    const time = new Date().toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((prev) => [...prev.slice(-300), { time, msg, type }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (shouldAutoStart && leads.length > 0 && !processing) {
      setShouldAutoStart(false);
      startProcessing();
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
            // Enriched fields
            empresaNormalizada: "",
            servicio: "",
            icebreaker: "",
            serpResults: null,
            serpQuery: "",
            hasRealSerpData: false,
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

  const getDisplayName = (lead) => {
    if (lead.empresa) return lead.empresa;
    const parts = [lead.nombre, lead.apellidos].filter(Boolean);
    return parts.join(" ") || "Sin nombre";
  };

  const processLead = async (lead, index) => {
    if (abortRef.current) return;

    const update = (fields) => {
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, ...fields } : l))
      );
    };

    const displayName = getDisplayName(lead);

    try {
      update({ status: "processing" });

      // FASE 1: Normalizar nombre de empresa
      addLog(`[${index + 1}] Normalizando: ${displayName}`);
      setProgress((p) => ({ ...p, phase: "Normalizando nombre" }));
      const { companyName } = await callApi("normalize-name", {
        name: displayName,
      });
      update({ empresaNormalizada: companyName });
      addLog(`[${index + 1}] → ${companyName}`, "success");

      if (abortRef.current) return;

      // FASE 2: Scraping web + servicio
      addLog(`[${index + 1}] Analizando web: ${lead.web || "sin web"}`);
      setProgress((p) => ({ ...p, phase: "Scraping web" }));
      const { servicio } = await callApi("extract-service", {
        website: lead.web,
      });
      update({ servicio });
      addLog(`[${index + 1}] Servicio: ${servicio}`, "success");

      if (abortRef.current) return;

      // FASE 3: Búsqueda real Google
      let serpResults = null;
      let serpQuery = "";
      if (lead.ciudad && servicio && servicio !== "su servicio principal") {
        addLog(`[${index + 1}] Google: "${servicio} en ${lead.ciudad}"`);
        setProgress((p) => ({ ...p, phase: "Google SERP" }));
        try {
          const serpData = await callApi("serp-search", {
            keyword: servicio,
            city: lead.ciudad,
          });
          serpResults = serpData.results;
          serpQuery = serpData.query;
          addLog(`[${index + 1}] SERP: ${serpResults.length} resultados`, "success");
        } catch (e) {
          addLog(`[${index + 1}] SERP fallido: ${e.message}`, "error");
        }
      }

      if (abortRef.current) return;

      // FASE 4: Icebreaker
      addLog(`[${index + 1}] Generando icebreaker...`);
      setProgress((p) => ({ ...p, phase: "Icebreaker" }));
      const ibData = await callApi("generate-icebreaker", {
        companyName,
        city: lead.ciudad,
        servicio,
        serpResults,
        website: lead.web,
      });

      update({
        icebreaker: ibData.icebreaker,
        serpResults,
        serpQuery,
        hasRealSerpData: ibData.hasRealSerpData,
        status: "done",
        error: "",
      });

      addLog(`[${index + 1}] Completado: ${companyName}`, "success");
    } catch (err) {
      update({ status: "error", error: err.message });
      addLog(`[${index + 1}] Error: ${err.message}`, "error");
    }

    setProgress((p) => ({ ...p, current: p.current + 1 }));
  };

  const startProcessing = async () => {
    abortRef.current = false;
    setProcessing(true);

    const pending = leads.filter((l) => l.status === "pending" || l.status === "error");
    setProgress({ current: 0, total: pending.length, phase: "Iniciando..." });
    addLog(`Procesando ${pending.length} leads (${CONCURRENCY} en paralelo)`, "info");

    const queue = [...pending];
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
    addLog(abortRef.current ? "Detenido por el usuario" : "Procesamiento completado!", abortRef.current ? "error" : "success");
  };

  const downloadCSV = () => {
    const rows = leads.map((l) => ({
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
      Sector: l.sector,
      "Dirección": l.direccion,
      "Servicio Detectado": l.servicio,
      Icebreaker: l.icebreaker,
      "Datos SERP Reales": l.hasRealSerpData ? "Sí" : "No",
      "Búsqueda Google": l.serpQuery,
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

  const stats = {
    total: leads.length,
    done: leads.filter((l) => l.status === "done").length,
    processing: leads.filter((l) => l.status === "processing").length,
    errors: leads.filter((l) => l.status === "error").length,
    serp: leads.filter((l) => l.hasRealSerpData).length,
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // ─── No leads: upload screen ───
  if (leads.length === 0) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="topbar-logo"><Zap size={16} /></div>
          <span className="topbar-title">Clay Clone — Lead Enrichment</span>
        </div>
        <div
          className="upload-overlay"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFileUpload(e.dataTransfer.files[0]); }}
        >
          <div
            className={`upload-box ${dragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon"><Upload size={28} /></div>
            <h3>Sube tu CSV de leads</h3>
            <p>Arrastra y suelta o <span className="highlight">haz clic para seleccionar</span></p>
            <p style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--text-dim)" }}>
              El enriquecimiento comienza automáticamente
            </p>
            <div className="upload-cols">
              {["Email","Nombre","Apellidos","Empresa","Web","Ciudad","Sector","Cargo"].map((c) => (
                <span key={c} className="upload-col-tag">{c}</span>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.CSV"
              style={{ display: "none" }}
              onChange={(e) => handleFileUpload(e.target.files[0])}
            />
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

  // ─── Main spreadsheet view ───
  return (
    <div className="app">
      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-logo"><Zap size={16} /></div>
        <span className="topbar-title">Clay Clone</span>
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

      {/* Toolbar */}
      <div className="toolbar">
        {!processing ? (
          <>
            <button
              className="toolbar-btn primary"
              onClick={startProcessing}
              disabled={stats.done === stats.total && stats.errors === 0}
            >
              <Play size={13} />
              {stats.done > 0 ? "Continuar" : "Enriquecer"}
            </button>
            {stats.done > 0 && (
              <button className="toolbar-btn success" onClick={downloadCSV}>
                <Download size={13} /> Descargar CSV
              </button>
            )}
            <div className="toolbar-separator" />
            <button className="toolbar-btn" onClick={() => setLeads((prev) => prev.map((l) => ({ ...l, empresaNormalizada: "", servicio: "", icebreaker: "", serpResults: null, serpQuery: "", hasRealSerpData: false, status: "pending", error: "" })))}>
              <RotateCcw size={13} /> Resetear
            </button>
            <button className="toolbar-btn danger" onClick={() => { setLeads([]); setLogs([]); setProgress({ current: 0, total: 0, phase: "" }); }}>
              <Trash2 size={13} /> Borrar
            </button>
          </>
        ) : (
          <button className="toolbar-btn danger" onClick={() => { abortRef.current = true; }}>
            <X size={13} /> Detener
          </button>
        )}
        <div className="toolbar-separator" />
        <button className="toolbar-btn" onClick={() => setShowLogs((v) => !v)}>
          <Square size={13} /> {showLogs ? "Ocultar log" : "Ver log"}
        </button>
      </div>

      {/* Progress strip */}
      {(processing || progress.total > 0) && (
        <div className="progress-strip">
          <div className="progress-strip-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* Spreadsheet */}
      <div className="spreadsheet-wrapper">
        <table className="spreadsheet">
          <colgroup>
            <col className="col-row-num" />
            <col className="col-status" />
            <col className="col-email" />
            <col className="col-narrow" />
            <col className="col-narrow" />
            <col className="col-medium" />
            <col className="col-url" />
            <col className="col-narrow" />
            <col className="col-narrow" />
            <col className="col-narrow" />
            <col className="col-narrow" />
            <col className="col-narrow" />
            {/* Enriched */}
            <col className="col-medium" />
            <col className="col-service" />
            <col className="col-serp" />
            <col className="col-icebreaker" />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>Estado</th>
              <th>Email</th>
              <th>Nombre</th>
              <th>Apellidos</th>
              <th>Empresa</th>
              <th>Web</th>
              <th>Ciudad</th>
              <th>Cargo</th>
              <th>Sector</th>
              <th>Teléfono</th>
              <th>Tag</th>
              {/* Enriched columns */}
              <th className="th-enriched"><span className="th-group-label">IA</span>Nombre Normalizado</th>
              <th className="th-enriched"><span className="th-group-label">IA</span>Servicio</th>
              <th className="th-enriched"><span className="th-group-label">IA</span>SERP</th>
              <th className="th-enriched"><span className="th-group-label">IA</span>Icebreaker</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead, idx) => (
              <tr
                key={lead.id}
                className={`row-${lead.status}`}
                onClick={() => lead.status === "done" && setSelectedLead(lead)}
                style={{ cursor: lead.status === "done" ? "pointer" : "default" }}
              >
                <td>{idx + 1}</td>
                <td><StatusChip status={lead.status} /></td>
                <td>{lead.email || "—"}</td>
                <td>{lead.nombre || "—"}</td>
                <td>{lead.apellidos || "—"}</td>
                <td style={{ fontWeight: 500 }}>{lead.empresa || "—"}</td>
                <td>
                  {lead.web ? (
                    <a
                      href={lead.web.startsWith("http") ? lead.web : `https://${lead.web}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cell-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {lead.web.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 30)}
                    </a>
                  ) : "—"}
                </td>
                <td>{lead.ciudad || "—"}</td>
                <td>{lead.cargo || "—"}</td>
                <td>{lead.sector || "—"}</td>
                <td>{lead.telefono || "—"}</td>
                <td>{lead.tag || "—"}</td>
                {/* Enriched */}
                <td className="cell-enriched cell-company">{lead.empresaNormalizada || "—"}</td>
                <td className="cell-enriched cell-service">{lead.servicio || "—"}</td>
                <td className="cell-enriched">
                  {lead.status === "done" && (
                    <span className={`serp-chip ${lead.hasRealSerpData ? "serp-real" : "serp-generic"}`}>
                      {lead.hasRealSerpData ? <><Search size={9} /> Real</> : <><Sparkles size={9} /> Gen.</>}
                    </span>
                  )}
                </td>
                <td className="cell-enriched cell-icebreaker">{lead.icebreaker || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Log drawer */}
      {showLogs && logs.length > 0 && (
        <div className="log-drawer">
          {logs.map((l, i) => (
            <div key={i} className="log-row">
              <span className="log-time">{l.time}</span>
              <span className={`log-msg ${l.type}`}>{l.msg}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Detail side panel */}
      {selectedLead && (
        <>
          <div className="detail-panel-overlay" onClick={() => setSelectedLead(null)} />
          <div className="detail-panel">
            <div className="detail-panel-header">
              <h2>
                <Sparkles size={18} style={{ color: "var(--accent)" }} />
                {selectedLead.empresaNormalizada || getDisplayName(selectedLead)}
              </h2>
              <button className="detail-close" onClick={() => setSelectedLead(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="detail-grid">
              <div className="detail-section">
                <div className="detail-label">Email</div>
                <div className="detail-value">{selectedLead.email || "—"}</div>
              </div>
              <div className="detail-section">
                <div className="detail-label">Ciudad</div>
                <div className="detail-value">{selectedLead.ciudad || "—"}</div>
              </div>
              <div className="detail-section">
                <div className="detail-label">Empresa original</div>
                <div className="detail-value">{selectedLead.empresa || "—"}</div>
              </div>
              <div className="detail-section">
                <div className="detail-label">Cargo</div>
                <div className="detail-value">{selectedLead.cargo || "—"}</div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-label">Nombre normalizado (IA)</div>
              <div className="detail-value accent">{selectedLead.empresaNormalizada}</div>
            </div>

            <div className="detail-section">
              <div className="detail-label">Servicio detectado (scraping web)</div>
              <div className="detail-value yellow">{selectedLead.servicio}</div>
            </div>

            {selectedLead.serpResults?.length > 0 && (
              <div className="detail-section">
                <div className="detail-label">
                  <Search size={11} style={{ verticalAlign: "middle" }} /> Google: "{selectedLead.serpQuery}"
                </div>
                {selectedLead.serpResults.map((r, i) => {
                  const isLead = selectedLead.web && r.url?.toLowerCase().includes(extractDomain(selectedLead.web).toLowerCase());
                  return (
                    <div key={i} className="serp-result-item">
                      <div className={`serp-pos ${isLead ? "is-lead" : ""}`}>{r.position}</div>
                      <div className="serp-detail">
                        <div className="title">
                          {r.title}
                          {isLead && <span style={{ marginLeft: 6, color: "var(--green)", fontSize: "0.66rem" }}>TU LEAD</span>}
                        </div>
                        <div className="domain">{r.domain || r.url}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="detail-section">
              <div className="detail-label">Icebreaker generado</div>
              <div className="detail-value" style={{ fontSize: "0.9rem", lineHeight: 1.6 }}>
                {selectedLead.icebreaker}
              </div>
              {selectedLead.hasRealSerpData && (
                <div style={{ marginTop: 6 }}>
                  <span className="serp-chip serp-real"><Search size={9} /> Basado en datos reales de Google</span>
                </div>
              )}
            </div>

            <div className="detail-actions">
              <button
                className="toolbar-btn primary"
                onClick={() => {
                  navigator.clipboard.writeText(selectedLead.icebreaker);
                  addLog("Icebreaker copiado", "success");
                }}
              >
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

function StatusChip({ status }) {
  const cfg = {
    pending: { label: "Pendiente", cls: "chip-pending", icon: Clock },
    processing: { label: "...", cls: "chip-processing", icon: Loader },
    done: { label: "Listo", cls: "chip-done", icon: CheckCircle2 },
    error: { label: "Error", cls: "chip-error", icon: AlertCircle },
  };
  const c = cfg[status] || cfg.pending;
  const Icon = c.icon;
  return (
    <span className={`status-chip ${c.cls}`}>
      <Icon size={11} className={status === "processing" ? "spinner" : ""} />
      {c.label}
    </span>
  );
}

function extractDomain(url) {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace("www.", "");
  } catch {
    return url;
  }
}

export default App;
