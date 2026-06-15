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
  Users,
  Sparkles,
  Search,
  Globe,
  Eye,
  X,
  Zap,
  FileText,
  RotateCcw,
} from "lucide-react";
import "./App.css";

const CONCURRENCY = 3;

const API_BASE = import.meta.env.DEV ? "" : "";

function App() {
  const [leads, setLeads] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: "" });
  const fileInputRef = useRef(null);
  const abortRef = useRef(false);
  const logEndRef = useRef(null);

  const addLog = useCallback((msg, type = "info") => {
    const time = new Date().toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setLogs((prev) => [...prev.slice(-200), { time, msg, type }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleFileUpload = (file) => {
    if (!file || !file.name.endsWith(".csv")) {
      addLog("El archivo debe ser un CSV", "error");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = results.data
          .filter((row) => row.name || row.email)
          .map((row, idx) => ({
            id: idx,
            name: row.name || "",
            email: row.email || "",
            website: row.website || "",
            state: row.state || "",
            address: row.address || "",
            country: row.country || "",
            query: row.query || "",
            source: row.source || "",
            companyName: "",
            servicio: "",
            icebreaker: "",
            serpResults: null,
            serpQuery: "",
            hasRealSerpData: false,
            status: "pending",
            error: "",
          }));

        setLeads(parsed);
        setLogs([]);
        addLog(`CSV cargado: ${parsed.length} leads encontrados`, "success");
      },
      error: (err) => {
        addLog(`Error al parsear CSV: ${err.message}`, "error");
      },
    });
  };

  const callApi = async (endpoint, body) => {
    const res = await fetch(`${API_BASE}/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${endpoint} (${res.status}): ${text}`);
    }
    return res.json();
  };

  const processLead = async (lead, index) => {
    if (abortRef.current) return;

    const update = (fields) => {
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, ...fields } : l))
      );
    };

    try {
      update({ status: "processing" });

      // FASE 1: Normalizar nombre
      addLog(`[${index + 1}] Normalizando: ${lead.name}`);
      setProgress((p) => ({ ...p, phase: "Normalizando nombre" }));
      const { companyName } = await callApi("normalize-name", {
        name: lead.name,
      });
      update({ companyName });
      addLog(`[${index + 1}] → ${companyName}`, "success");

      if (abortRef.current) return;

      // FASE 2: Extraer servicio de la web
      addLog(`[${index + 1}] Analizando web: ${lead.website || "sin web"}`);
      setProgress((p) => ({ ...p, phase: "Scraping web + servicio" }));
      const { servicio } = await callApi("extract-service", {
        website: lead.website,
      });
      update({ servicio });
      addLog(`[${index + 1}] Servicio: ${servicio}`, "success");

      if (abortRef.current) return;

      // FASE 3: Búsqueda real en Google con Serper
      let serpResults = null;
      let serpQuery = "";
      if (lead.state && servicio && servicio !== "su servicio principal") {
        addLog(`[${index + 1}] Buscando en Google: "${servicio} en ${lead.state}"`);
        setProgress((p) => ({ ...p, phase: "Búsqueda en Google" }));
        try {
          const serpData = await callApi("serp-search", {
            keyword: servicio,
            city: lead.state,
          });
          serpResults = serpData.results;
          serpQuery = serpData.query;
          addLog(
            `[${index + 1}] SERP: ${serpResults.length} resultados para "${serpQuery}"`,
            "success"
          );
        } catch (serpErr) {
          addLog(
            `[${index + 1}] SERP fallido (se usará icebreaker genérico): ${serpErr.message}`,
            "error"
          );
        }
      }

      if (abortRef.current) return;

      // FASE 4: Generar icebreaker
      addLog(`[${index + 1}] Generando icebreaker para ${companyName}`);
      setProgress((p) => ({ ...p, phase: "Generando icebreaker" }));
      const ibData = await callApi("generate-icebreaker", {
        companyName,
        city: lead.state,
        servicio,
        serpResults,
        website: lead.website,
      });

      update({
        icebreaker: ibData.icebreaker,
        serpResults,
        serpQuery,
        hasRealSerpData: ibData.hasRealSerpData,
        status: "done",
        error: "",
      });

      addLog(`[${index + 1}] ✓ Completado: ${companyName}`, "success");
    } catch (err) {
      update({ status: "error", error: err.message });
      addLog(`[${index + 1}] ✗ Error: ${err.message}`, "error");
    }

    setProgress((p) => ({ ...p, current: p.current + 1 }));
  };

  const startProcessing = async () => {
    abortRef.current = false;
    setProcessing(true);

    const pending = leads.filter(
      (l) => l.status === "pending" || l.status === "error"
    );
    setProgress({ current: 0, total: pending.length, phase: "Iniciando..." });
    addLog(`Iniciando procesamiento de ${pending.length} leads`, "info");

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
    if (abortRef.current) {
      addLog("Procesamiento detenido por el usuario", "error");
    } else {
      addLog("¡Procesamiento completado!", "success");
    }
  };

  const stopProcessing = () => {
    abortRef.current = true;
    addLog("Deteniendo procesamiento...", "error");
  };

  const resetLeads = () => {
    setLeads((prev) =>
      prev.map((l) => ({
        ...l,
        companyName: "",
        servicio: "",
        icebreaker: "",
        serpResults: null,
        serpQuery: "",
        hasRealSerpData: false,
        status: "pending",
        error: "",
      }))
    );
    setLogs([]);
    setProgress({ current: 0, total: 0, phase: "" });
    addLog("Leads reseteados", "info");
  };

  const downloadCSV = () => {
    const rows = leads.map((l) => ({
      name: l.name,
      email: l.email,
      website: l.website,
      state: l.state,
      address: l.address,
      country: l.country,
      query: l.query,
      source: l.source,
      companyName: l.companyName,
      servicio_destacado: l.servicio,
      icebreaker: l.icebreaker,
      datos_serp_reales: l.hasRealSerpData ? "sí" : "no",
      busqueda_google: l.serpQuery,
    }));

    const csv = Papa.unparse(rows);
    const blob = new Blob(["\ufeff" + csv], {
      type: "text/csv;charset=utf-8;",
    });
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
    withSerp: leads.filter((l) => l.hasRealSerpData).length,
  };

  const progressPercent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="app">
      <header className="header">
        <div className="header-icon">
          <Zap size={22} />
        </div>
        <div>
          <h1>Clay Clone — Lead Enrichment Pipeline</h1>
          <p>
            CSV → Normalización → Web Scraping → Google SERP → Icebreaker
            personalizado
          </p>
        </div>
      </header>

      <main className="main">
        {leads.length === 0 ? (
          <div
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              handleFileUpload(file);
            }}
          >
            <div className="upload-zone-icon">
              <Upload size={28} />
            </div>
            <h3>Sube tu CSV de leads</h3>
            <p>
              Arrastra y suelta o{" "}
              <span className="highlight">haz clic para seleccionar</span>
            </p>
            <p style={{ marginTop: 8 }}>
              Columnas esperadas: name, email, website, state
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => handleFileUpload(e.target.files[0])}
            />
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="stats-bar">
              <div className="stat-card">
                <div className="stat-icon purple">
                  <Users size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-value">{stats.total}</span>
                  <span className="stat-label">Total leads</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green">
                  <CheckCircle2 size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-value">{stats.done}</span>
                  <span className="stat-label">Completados</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon yellow">
                  <Loader size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-value">{stats.processing}</span>
                  <span className="stat-label">Procesando</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon blue">
                  <Search size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-value">{stats.withSerp}</span>
                  <span className="stat-label">Con datos SERP reales</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon red">
                  <AlertCircle size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-value">{stats.errors}</span>
                  <span className="stat-label">Errores</span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="controls">
              {!processing ? (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={startProcessing}
                    disabled={stats.done === stats.total && stats.errors === 0}
                  >
                    <Play size={16} />
                    {stats.done > 0 ? "Continuar procesamiento" : "Iniciar enriquecimiento"}
                  </button>
                  {stats.done > 0 && (
                    <button className="btn btn-success" onClick={downloadCSV}>
                      <Download size={16} />
                      Descargar CSV enriquecido
                    </button>
                  )}
                  <button className="btn btn-secondary" onClick={resetLeads}>
                    <RotateCcw size={16} />
                    Resetear
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      setLeads([]);
                      setLogs([]);
                      setProgress({ current: 0, total: 0, phase: "" });
                    }}
                  >
                    <Trash2 size={16} />
                    Eliminar todo
                  </button>
                </>
              ) : (
                <button className="btn btn-danger" onClick={stopProcessing}>
                  <X size={16} />
                  Detener procesamiento
                </button>
              )}
            </div>

            {/* Progress */}
            {(processing || progress.total > 0) && (
              <div className="progress-container">
                <div className="progress-header">
                  <span>
                    {processing ? (
                      <>
                        <Loader size={14} className="spinner" style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {progress.phase}
                      </>
                    ) : (
                      "Procesamiento completado"
                    )}
                  </span>
                  <strong>
                    {progress.current} / {progress.total} ({progressPercent}%)
                  </strong>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="progress-phases">
                  <PhaseTag label="Normalizar" phase={1} current={progress.phase} />
                  <PhaseTag label="Scraping web" phase={2} current={progress.phase} />
                  <PhaseTag label="Google SERP" phase={3} current={progress.phase} />
                  <PhaseTag label="Icebreaker" phase={4} current={progress.phase} />
                </div>
              </div>
            )}

            {/* Table */}
            <div className="table-container">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Nombre original</th>
                      <th>Nombre normalizado</th>
                      <th>Ciudad</th>
                      <th>Web</th>
                      <th>Servicio detectado</th>
                      <th>SERP</th>
                      <th>Icebreaker</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, idx) => (
                      <tr key={lead.id}>
                        <td style={{ color: "var(--text-dim)" }}>{idx + 1}</td>
                        <td className="cell-name">{lead.name}</td>
                        <td className="cell-normalized">
                          {lead.companyName || "—"}
                        </td>
                        <td>{lead.state || "—"}</td>
                        <td className="cell-website">
                          {lead.website ? (
                            <a
                              href={
                                lead.website.startsWith("http")
                                  ? lead.website
                                  : `https://${lead.website}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="cell-service">
                          {lead.servicio || "—"}
                        </td>
                        <td>
                          {lead.status === "done" && (
                            <span
                              className={`cell-serp-badge ${
                                lead.hasRealSerpData
                                  ? "serp-badge-real"
                                  : "serp-badge-generic"
                              }`}
                            >
                              {lead.hasRealSerpData ? (
                                <>
                                  <Search size={10} /> Real
                                </>
                              ) : (
                                <>
                                  <Sparkles size={10} /> Genérico
                                </>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="cell-icebreaker">
                          {lead.icebreaker
                            ? lead.icebreaker.length > 120
                              ? lead.icebreaker.slice(0, 120) + "..."
                              : lead.icebreaker
                            : "—"}
                        </td>
                        <td className="cell-status">
                          <StatusBadge status={lead.status} />
                        </td>
                        <td>
                          {lead.status === "done" && (
                            <button
                              className="btn btn-secondary"
                              style={{ padding: "4px 8px", fontSize: "0.72rem" }}
                              onClick={() => setSelectedLead(lead)}
                            >
                              <Eye size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Logs */}
            {logs.length > 0 && (
              <div className="log-panel">
                {logs.map((log, idx) => (
                  <div key={idx} className="log-entry">
                    <span className="log-time">{log.time}</span>
                    <span className={`log-msg ${log.type}`}>{log.msg}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </>
        )}
      </main>

      {/* Detail modal */}
      {selectedLead && (
        <div className="modal-overlay" onClick={() => setSelectedLead(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              <Sparkles size={20} style={{ color: "var(--accent)" }} />
              {selectedLead.companyName || selectedLead.name}
            </h2>

            <div className="modal-section">
              <label>Nombre original → Normalizado</label>
              <div className="value">
                {selectedLead.name} → <span style={{ color: "var(--accent)" }}>{selectedLead.companyName}</span>
              </div>
            </div>

            <div className="modal-section">
              <label>Ciudad</label>
              <div className="value">{selectedLead.state || "No disponible"}</div>
            </div>

            <div className="modal-section">
              <label>Servicio detectado (scraping web)</label>
              <div className="value yellow">{selectedLead.servicio}</div>
            </div>

            {selectedLead.serpResults && selectedLead.serpResults.length > 0 && (
              <div className="modal-section">
                <label>
                  <Search size={12} style={{ verticalAlign: "middle" }} />{" "}
                  Resultados reales de Google: "{selectedLead.serpQuery}"
                </label>
                <div>
                  {selectedLead.serpResults.map((r, i) => {
                    const isLead =
                      selectedLead.website &&
                      r.url
                        ?.toLowerCase()
                        .includes(
                          extractDomain(selectedLead.website).toLowerCase()
                        );
                    return (
                      <div key={i} className="serp-result-item">
                        <div
                          className={`serp-position ${isLead ? "is-lead" : ""}`}
                        >
                          {r.position}
                        </div>
                        <div className="serp-info">
                          <div className="title">
                            {r.title}
                            {isLead && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  color: "var(--green)",
                                  fontSize: "0.7rem",
                                }}
                              >
                                ← TU LEAD
                              </span>
                            )}
                          </div>
                          <div className="domain">{r.domain || r.url}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="modal-section">
              <label>Icebreaker generado</label>
              <div className="value" style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>
                {selectedLead.icebreaker}
              </div>
              {selectedLead.hasRealSerpData && (
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span className="cell-serp-badge serp-badge-real">
                    <Search size={10} /> Basado en datos reales de Google
                  </span>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(selectedLead.icebreaker);
                  addLog("Icebreaker copiado al portapapeles", "success");
                }}
              >
                Copiar icebreaker
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setSelectedLead(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    pending: { label: "Pendiente", cls: "status-pending", icon: Clock },
    processing: { label: "Procesando", cls: "status-processing", icon: Loader },
    done: { label: "Listo", cls: "status-done", icon: CheckCircle2 },
    error: { label: "Error", cls: "status-error", icon: AlertCircle },
  };

  const c = config[status] || config.pending;
  const Icon = c.icon;

  return (
    <span className={`status-badge ${c.cls}`}>
      <Icon size={12} className={status === "processing" ? "spinner" : ""} />
      {c.label}
    </span>
  );
}

function PhaseTag({ label, phase, current }) {
  const phaseMap = {
    1: "Normalizando nombre",
    2: "Scraping web + servicio",
    3: "Búsqueda en Google",
    4: "Generando icebreaker",
  };
  const isActive = current === phaseMap[phase];
  const isDone = false;

  return (
    <span className={`phase-tag ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}>
      <span className="phase-dot" />
      {label}
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
