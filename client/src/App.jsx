/*
  Copyright © 2025 Vien Trieu  
  This software is proprietary to ABB and may be viewed internally
  but may not be copied, distributed, used, or modified outside ABB
  without explicit written permission.

  Full license details can be found in LICENSE.md.


/*
Author: Vien Trieu (Date: 6-27-2025)
App.jsx is the central backbone of the application, responsible for initializing the app, managing global state,
coordinating data flow, and rendering all primary UI components. It brings together frontend logic, backend communication,
and user interactions to ensure the application runs reliably, efficiently, and as a unified experience.
*/

import React, { useState, useEffect, useRef } from "react";
import SplashScreen from "./components/SplashScreen";
import ABB from "./assets/ABB.png";
import "./index.css";
import "./animations.css";
import "./App.css";

const API_BASE =
  (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) ||
  "http://127.0.0.1:3002";

/** Robust fetch with timeout, retry, and no-store cache (handles 204/empty bodies) */
/** Faster default: 3s timeout, no retry */
async function fetchJSON(
  path,
  options = {},
  { retries = 0, timeoutMs = 3000 } = {},
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 250));
      return fetchJSON(path, options, { retries: retries - 1, timeoutMs });
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

function App() {
  /* === UI / splash control === */
  const [showSplash, setShowSplash] = useState(true);

  /* === Search state === */
  const [query, setQuery] = useState("");
  const [type, setType] = useState("name"); // name | number
  const [results, setResults] = useState([]);
  const [selectedPart, setSelectedPart] = useState(null);

  /* === Editing state === */
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({
    name: "",
    part_number: "",
    location: "",
    image_url: "",
  });

  /* === Image state (Add + Edit) ======================================= */
  const [addImageFile, setAddImageFile] = useState(null);
  const [addImagePreview, setAddImagePreview] = useState("");
  const [editImageFile, setEditImageFile] = useState(null);
  const [editImagePreview, setEditImagePreview] = useState("");

  /* === Authorization for managing parts === */
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pin, setPin] = useState("");

  /* === Pagination (search results) === */
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 5;

  /* === Feedback / UX state === */
  const [isLoading, setIsLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmCallback, setConfirmCallback] = useState(() => {});
  const [notification, setNotification] = useState("");
  const [lastError, setLastError] = useState("");

  /* === Global popup message (replaces alert) === */
  const [popupMessage, setPopupMessage] = useState("");

  /* === Activity log === */
  const [logs, setLogs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("activityLogs")) || [];
    } catch {
      return [];
    }
  });
  const [logPinPrompt, setLogPinPrompt] = useState(false);
  const [logPin, setLogPin] = useState("");
  const [logsAuthorized, setLogsAuthorized] = useState(false);

  /* === Activity log pagination === */
  const [logPage, setLogPage] = useState(1);
  const LOGS_PER_PAGE = 10;

  /* === View mode (main or logs) === */
  const [viewMode, setViewMode] = useState("main");

  // Remember last successful search params
  const lastSearchRef = useRef({ query: "", type: "name", page: 1 });
  const skipNextSearchRef = useRef(false);

  /* === Suggestions state (for part number type-ahead) === */
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const suggestAbortRef = useRef(null);

  /** upload image helper (multipart/form-data) */
  const uploadImage = async (file) => {
    if (!file) return null;

    const data = new FormData();
    data.append("file", file);

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const res = await fetch(`${API_BASE}/upload-image`, {
        method: "POST",
        body: data,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Image upload failed (HTTP ${res.status})`);
      }
      const json = await res.json();
      return json.image_url || null;
    } finally {
      clearTimeout(id);
    }
  };

  /** Execute a search based on current query/type/page */
  const handleSearch = async ({ suppressLog = false } = {}) => {
    if (!query.trim()) {
      setResults([]);
      setLastError("");
      return;
    }
    setIsLoading(true);
    setLastError("");
    try {
      const qs = new URLSearchParams({
        [type]: query,
        page: String(page),
        limit: String(limit),
      }).toString();

      const data = await fetchJSON(`/parts?${qs}`);
      if (data) {
        setResults(Array.isArray(data.results) ? data.results : []);
        setTotalPages(Number.isFinite(data.totalPages) ? data.totalPages : 1);
      } else {
        setResults([]);
        setTotalPages(1);
      }
      if (!suppressLog) {
        addLog(
          `Searched parts by "${type}" with query "${query}" (page ${page})`,
        );
      }
      // Save last successful search
      lastSearchRef.current = { query, type, page };
      try {
        localStorage.setItem(
          "lastSearch",
          JSON.stringify(lastSearchRef.current),
        );
      } catch {}
    } catch (error) {
      console.error("Search failed:", error);
      setLastError("Search failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  /** Fetch suggestions for part numbers (prefix match) */
  const fetchSuggestions = async (prefix) => {
    if (suggestAbortRef.current) {
      suggestAbortRef.current.abort();
    }
    const controller = new AbortController();
    suggestAbortRef.current = controller;

    try {
      const qs = new URLSearchParams({
        numberPrefix: prefix,
        limit: "8",
      }).toString();
      const data = await fetchJSON(`/parts/suggest?${qs}`, {
        signal: controller.signal,
      });
      setSuggestions(Array.isArray(data) ? data : []);
      setShowSuggestions(true);
      setHighlightIndex(-1);
    } catch (e) {
      // ignore
    } finally {
      suggestAbortRef.current = null;
    }
  };

  /** Re-run search when query/type changes (reset to page 1 or search if already 1) */
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (type === "number") {
      const prefix = query.trim();
      const id = setTimeout(() => {
        if (prefix.length >= 1) fetchSuggestions(prefix);
        else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      }, 200);

      return () => clearTimeout(id);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type]);

  /** Re-run search when page changes */
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, page]);

  /** Restore last search from localStorage on mount (optional persistence) */
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("lastSearch"));
      if (saved && saved.query && saved.query.trim()) {
        setQuery(saved.query);
        setType(saved.type || "name");
        lastSearchRef.current = {
          query: saved.query,
          type: saved.type || "name",
          page: 1,
        };
        skipNextSearchRef.current = true;
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Periodic auto-refresh of the last successful search while app is idle/visible */
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const { query: lastQuery } = lastSearchRef.current;
      if (!lastQuery || !lastQuery.trim()) return;
      if (viewMode !== "main") return;
      if (isLoading) return;
      // Silent refresh: do not spam logs
      handleSearch({ suppressLog: true });
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, isLoading]);

  /** Delete part and refresh results */
  const performDelete = async (part) => {
    const { id, name, part_number, location } = part;
    try {
      await fetchJSON(`/parts/${id}`, { method: "DELETE" });
      if (query) await handleSearch();
      else setResults((prev) => prev.filter((p) => p.id !== id));
      setNotification("Part deleted successfully!");
      addLog(
        `Deleted part "${name}" (Part #${part_number}, Location: ${location})`,
      );
      setTimeout(() => setNotification(""), 3000);
    } catch (error) {
      console.error("Error deleting part:", error);
      setPopupMessage("Failed to delete part.");
    }
  };

  /** Open confirmation dialog */
  const handleDelete = (part) => {
    setConfirmMessage(
      `Are you sure you want to delete "${part.name}" (Part #${part.part_number})?`,
    );
    setConfirmCallback(() => () => performDelete(part));
    setConfirmOpen(true);
  };

  /** Start editing */
  const handleEdit = (part) => {
    setEditingId(part.id);
    setEditValues({
      name: part.name,
      part_number: part.part_number,
      location: part.location,
      image_url: part.image_url || "", // ⭐ NEW
    });
    setEditImageFile(null); // ⭐ NEW
    setEditImagePreview(part.image_url || ""); // ⭐ NEW
  };

  /** Edit inputs change */
  const handleEditChange = (e) => {
    setEditValues({ ...editValues, [e.target.name]: e.target.value });
  };

  /**  Add-form image change */
  const handleAddImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setAddImageFile(null);
      setAddImagePreview("");
      return;
    }
    setAddImageFile(file);
    setAddImagePreview(URL.createObjectURL(file));
  };

  /**  Edit-form image change */
  const handleEditImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setEditImageFile(null);
      setEditImagePreview(editValues.image_url || "");
      return;
    }
    setEditImageFile(file);
    setEditImagePreview(URL.createObjectURL(file));
  };

  /** Save edited part (including optional image) */
  const handleEditSave = async (id) => {
    const { name, part_number, location } = editValues;
    if (!name.trim() || !part_number.trim() || !location.trim()) {
      setPopupMessage("You must complete every field before saving changes.");
      return;
    }
    try {
      let image_url = editValues.image_url || null;

      // If user picked a new file, upload it first
      if (editImageFile) {
        image_url = await uploadImage(editImageFile);
      }

      const payload = {
        name: name.trim(),
        part_number: part_number.trim(),
        location: location.trim(),
        image_url,
      };

      const updated = await fetchJSON(`/parts/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      if (updated) {
        setResults((prev) => prev.map((p) => (p.id === id ? updated : p)));
      }
      addLog(
        `Edited part "${payload.name}" (Part #${payload.part_number}, Location: ${payload.location})`,
      );
      setEditingId(null);
      setEditImageFile(null);
      setEditImagePreview("");
    } catch (error) {
      console.error("Error updating part:", error);
      setPopupMessage("Failed to update part.");
    }
  };

  /** Append an entry to the activity log and persist */
  const addLog = (action) => {
    const now = new Date();
    const timestamp = now.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const entry = { id: Date.now(), action, timestamp };
    setLogs((prev) => {
      // newest first
      const updated = [entry, ...prev];
      try {
        localStorage.setItem("activityLogs", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  /** Submit logs PIN */
  const submitLogPin = (e) => {
    e.preventDefault();

    if (!/^\d+$/.test(logPin)) {
      setPopupMessage("PIN must be numeric.");
      setLogPin("");
      return;
    }
    if (logPin === "4872") {
      setLogsAuthorized(true);
      setLogPinPrompt(false);
      setLogPin("");
      setViewMode("logs");
      setLogPage(1);
    } else {
      setPopupMessage("Incorrect PIN for logs.");
      setLogPin("");
    }
  };

  /** when user picks a suggestion */
  const pickSuggestion = (s) => {
    setQuery(s.part_number);
    setShowSuggestions(false);
    setSuggestions([]);
    if (page !== 1) setPage(1);
    else handleSearch();
  };

  /** keyboard handling on input */
  const onQueryKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex(
        (i) => (i - 1 + suggestions.length) % suggestions.length,
      );
    } else if (e.key === "Enter") {
      if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
        e.preventDefault();
        pickSuggestion(suggestions[highlightIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  // Close suggestions when clicking outside
  const inputWrapperRef = useRef(null);
  useEffect(() => {
    const onDocClick = (e) => {
      if (!inputWrapperRef.current) return;
      if (!inputWrapperRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  /* === Derived pagination for logs === */
  const totalLogPages = Math.max(
    1,
    Math.ceil(logs.length / LOGS_PER_PAGE || 1),
  );
  const currentLogPage = Math.min(logPage, totalLogPages);
  const logStartIndex = (currentLogPage - 1) * LOGS_PER_PAGE;
  const pageLogs = logs.slice(logStartIndex, logStartIndex + LOGS_PER_PAGE);

  return (
    <>
      {/* Splash screen overlay */}
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}

      <div
        style={{ opacity: showSplash ? 0 : 1, transition: "opacity 0.5s ease" }}
      >
        {/* Logo */}
        <div className="logo-container">
          <img src={ABB} alt="ABB Logo" className="logo" />
        </div>

        {/* === Activity Logs View === */}
        {viewMode === "logs" && logsAuthorized && (
          <div className="min-h-screen bg-gray-100 flex items-start justify-center p-6">
            <div className="bg-white shadow-xl rounded-2xl p-8 max-w-2xl w-full">
              <button
                onClick={() => {
                  setViewMode("main");
                  setLogsAuthorized(false);
                  setLogPage(1);
                }}
                className="mb-4 bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded text-lg"
              >
                ← Back
              </button>
              <h2 className="text-2xl font-bold mb-4">Activity Logs</h2>
              {logs.length === 0 ? (
                <p>No actions logged yet.</p>
              ) : (
                <>
                  <ul className="list-disc pl-5 space-y-1 mb-4">
                    {pageLogs.map((log) => (
                      <li key={log.id}>
                        <span className="font-mono">{log.timestamp}</span> —{" "}
                        {log.action}
                      </li>
                    ))}
                  </ul>
                  {totalLogPages > 1 && (
                    <div className="flex justify-between items-center mt-2">
                      <button
                        disabled={currentLogPage === 1}
                        onClick={() =>
                          setLogPage((prev) => Math.max(1, prev - 1))
                        }
                        className={`px-4 py-2 rounded text-lg ${
                          currentLogPage === 1
                            ? "bg-gray-300"
                            : "bg-blue-500 text-white"
                        }`}
                      >
                        Previous
                      </button>
                      <span className="text-gray-700">
                        Page {currentLogPage} of {totalLogPages}
                      </span>
                      <button
                        disabled={currentLogPage >= totalLogPages}
                        onClick={() =>
                          setLogPage((prev) =>
                            Math.min(totalLogPages, prev + 1),
                          )
                        }
                        className={`px-4 py-2 rounded text-lg ${
                          currentLogPage >= totalLogPages
                            ? "bg-gray-300"
                            : "bg-blue-500 text-white"
                        }`}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* === Main Lookup Page === */}
        {viewMode === "main" && (
          <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
            <div className="bg-white shadow-xl rounded-2xl p-8 max-w-2xl w-full">
              <h1 className="text-3xl font-bold mb-6 text-gray-800 text-center">
                🔎 Part Lookup
              </h1>

              {/* Notification banner */}
              {notification && (
                <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
                  {notification}
                </div>
              )}

              {/* Error banner with retry */}
              {lastError && (
                <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded flex justify-between items-center">
                  <span>{lastError}</span>
                  <button
                    onClick={() => handleSearch()}
                    className="ml-4 btn-blue text-lg px-4 py-2"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* === Detail View === */}
              {selectedPart ? (
                <>
                  <button
                    onClick={() => setSelectedPart(null)}
                    className="mb-6 bg-gray-500 hover:bg-gray-600 text-white px-5 py-3 rounded text-lg"
                  >
                    ← Back to Results
                  </button>
                  <div className="space-y-4">
                    {selectedPart.image_url /* big image */ && (
                      <img
                        src={selectedPart.image_url}
                        alt={selectedPart.name}
                        className="w-full max-h-64 object-contain border rounded mb-4"
                      />
                    )}
                    <h2 className="text-2xl font-bold text-blue-800">
                      {selectedPart.name}
                    </h2>
                    <p className="text-gray-700">
                      Part Number: {selectedPart.part_number}
                    </p>
                    <p className="text-gray-700">
                      Location: {selectedPart.location}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  {/* Reset to root / clear search */}
                  {results.length > 0 && (
                    <button
                      onClick={() => {
                        setResults([]);
                        setQuery("");
                        setSelectedPart(null);
                        setPage(1);
                      }}
                      className="mb-6 bg-gray-500 hover:bg-gray-600 text-white px-5 py-3 rounded text-lg"
                    >
                      ← Home
                    </button>
                  )}

                  {/* === Authorization / PIN controls === */}
                  {!isAuthorized && (
                    <>
                      <button
                        onClick={() => setShowPinPrompt((prev) => !prev)}
                        className="mb-4 bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded text-lg"
                        title="Enter PIN to manage parts"
                      >
                        Manage Parts
                      </button>
                      {showPinPrompt && !isAuthorized && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();

                            if (!/^\d+$/.test(pin)) {
                              setPopupMessage("PIN must be numeric.");
                              setPin("");
                              return;
                            }
                            if (pin === "9063") {
                              setIsAuthorized(true);
                              setPin("");
                              setShowPinPrompt(false);
                            } else {
                              setPopupMessage("Incorrect PIN.");
                              setPin("");
                            }
                          }}
                          className="mb-6"
                        >
                          <input
                            type="password"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className="input mb-2 text-lg py-3"
                            placeholder="Enter 4-digit PIN"
                            maxLength={4}
                          />
                          <button
                            type="submit"
                            className="btn-blue text-lg px-6 py-3"
                          >
                            Submit
                          </button>
                        </form>
                      )}

                      {/* Activity logs access */}
                      <button
                        onClick={() => setLogPinPrompt((prev) => !prev)}
                        disabled={logsAuthorized}
                        className="mb-6 bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded text-lg disabled:opacity-50"
                      >
                        View Activity Logs
                      </button>
                      {logPinPrompt && !logsAuthorized && (
                        <form onSubmit={submitLogPin} className="mb-6">
                          <input
                            type="password"
                            value={logPin}
                            onChange={(e) => setLogPin(e.target.value)}
                            className="input mb-2 text-lg py-3"
                            placeholder="Enter 4-digit PIN"
                            maxLength={4}
                          />
                          <button
                            type="submit"
                            className="btn-blue text-lg px-6 py-3"
                          >
                            Submit
                          </button>
                        </form>
                      )}
                    </>
                  )}

                  {/* === Add New Part (requires authorization) === */}
                  {isAuthorized && (
                    <>
                      <button
                        onClick={() => {
                          setIsAuthorized(false);
                          setEditingId(null);
                          setAddImageFile(null); // ⭐ NEW
                          setAddImagePreview(""); // ⭐ NEW
                        }}
                        className="mb-4 bg-gray-300 hover:bg-gray-400 text-gray-800 px-5 py-3 rounded text-lg"
                      >
                        ← Back
                      </button>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();

                          const name = e.target.name.value.trim();
                          const part_number = e.target.part_number.value.trim();
                          const location = e.target.location.value.trim();
                          if (!name || !part_number || !location) {
                            setPopupMessage(
                              "You must complete every field before adding a part.",
                            );
                            return;
                          }
                          try {
                            let image_url = null;
                            if (addImageFile) {
                              image_url = await uploadImage(addImageFile);
                            }

                            const body = {
                              name,
                              part_number,
                              location,
                              image_url,
                            };

                            const newPart = await fetchJSON("/parts", {
                              method: "POST",
                              body: JSON.stringify(body),
                            });
                            setResults((prev) => [newPart, ...prev]);
                            addLog(
                              `Added part "${newPart.name}" (Part #${newPart.part_number}, Location: ${newPart.location})`,
                            );
                            e.target.reset();
                            setAddImageFile(null);
                            setAddImagePreview("");
                          } catch (error) {
                            console.error("Error adding part:", error);
                            setPopupMessage(
                              `Failed to add part. ${
                                error.message || "Unknown error."
                              }`,
                            );
                          }
                        }}
                        className="mb-8 space-y-4"
                      >
                        <h2 className="text-xl font-semibold text-gray-800">
                          ➕ Add New Part
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <input
                            name="name"
                            placeholder="Name"
                            className="input text-lg py-3"
                          />
                          <input
                            name="part_number"
                            placeholder="Part Number"
                            className="input text-lg py-3"
                          />
                          <input
                            name="location"
                            placeholder="Location"
                            className="input text-lg py-3"
                          />
                        </div>

                        {/* Add-part image upload + preview */}
                        <div className="flex items-center gap-4">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleAddImageChange}
                            className="text-sm"
                          />
                          {addImagePreview && (
                            <img
                              src={addImagePreview}
                              alt="Preview"
                              className="h-16 w-16 object-cover border rounded"
                            />
                          )}
                        </div>

                        <button
                          type="submit"
                          className="btn-green text-lg px-6 py-3"
                        >
                          Add Part
                        </button>
                      </form>
                    </>
                  )}

                  {/* === Search Form === */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (page !== 1) setPage(1);
                      else handleSearch();
                    }}
                    className="flex flex-col md:flex-row gap-4 mb-6"
                  >
                    <div className="relative w-full" ref={inputWrapperRef}>
                      <input
                        className="input w-full text-lg py-3"
                        placeholder={`Search by ${type}`}
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          setShowSuggestions(true);
                        }}
                        onKeyDown={onQueryKeyDown}
                        onFocus={() => {
                          if (type === "number" && suggestions.length)
                            setShowSuggestions(true);
                        }}
                      />
                      {type === "number" &&
                        showSuggestions &&
                        suggestions.length > 0 && (
                          <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-auto">
                            {suggestions.map((s, idx) => (
                              <li
                                key={s.id}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                }}
                                onClick={() => pickSuggestion(s)}
                                className={`px-3 py-2 cursor-pointer ${
                                  idx === highlightIndex
                                    ? "bg-blue-100"
                                    : "hover:bg-gray-100"
                                }`}
                              >
                                <div className="flex justify-between">
                                  <span className="font-semibold text-gray-800">
                                    {s.part_number}
                                  </span>
                                  <span className="text-gray-500">
                                    {s.location}
                                  </span>
                                </div>
                                <div className="text-sm text-gray-600">
                                  {s.name}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>

                    <select
                      className="input text-lg py-3"
                      value={type}
                      onChange={(e) => {
                        setType(e.target.value);
                        setShowSuggestions(false);
                        setSuggestions([]);
                      }}
                    >
                      <option value="name">Name</option>
                      <option value="number">Number</option>
                    </select>
                    <button
                      type="submit"
                      onClick={() => {
                        if (page === 1) handleSearch();
                      }}
                      className="btn-blue text-lg px-6 py-3"
                    >
                      Search
                    </button>
                  </form>

                  {/* Loading indicator */}
                  {isLoading && (
                    <div className="flex justify-center items-center my-4">
                      <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-10 w-10"></div>
                    </div>
                  )}

                  {/* === Results List === */}
                  {results.length > 0 && (
                    <>
                      <h2 className="text-xl font-semibold text-gray-800 mb-4">
                        🔍 Search Results
                      </h2>
                      <ul className="space-y-3 animate-fade-in">
                        {results.map((part) => (
                          <li
                            key={part.id}
                            className="border border-gray-200 p-4 rounded-xl bg-blue-50 shadow-sm hover:shadow-md transition cursor-pointer"
                            onClick={
                              editingId === part.id
                                ? undefined
                                : () => setSelectedPart(part)
                            }
                          >
                            {editingId === part.id ? (
                              <div className="space-y-2">
                                <div className="grid grid-cols-3 gap-4">
                                  <input
                                    name="name"
                                    value={editValues.name}
                                    onChange={handleEditChange}
                                    className="input text-lg py-3"
                                  />
                                  <input
                                    name="part_number"
                                    value={editValues.part_number}
                                    onChange={handleEditChange}
                                    className="input text-lg py-3"
                                  />
                                  <input
                                    name="location"
                                    value={editValues.location}
                                    onChange={handleEditChange}
                                    className="input text-lg py-3"
                                  />
                                </div>

                                {/* Edit image upload + preview */}
                                <div className="mt-2 flex items-center gap-4">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleEditImageChange}
                                    className="text-sm"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  {(editImagePreview || part.image_url) && (
                                    <img
                                      src={editImagePreview || part.image_url}
                                      alt={part.name}
                                      className="h-16 w-16 object-cover border rounded"
                                    />
                                  )}
                                </div>

                                <div className="flex space-x-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditSave(part.id);
                                    }}
                                    className="btn-green text-lg px-6 py-3"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingId(null);
                                      setEditImageFile(null);
                                      setEditImagePreview("");
                                    }}
                                    className="btn-gray text-lg px-6 py-3"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-4">
                                  {part.image_url && (
                                    <img
                                      src={part.image_url}
                                      alt={part.name}
                                      className="h-16 w-16 object-cover border rounded"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedPart(part);
                                      }}
                                    />
                                  )}
                                  <div className="flex-1 grid grid-cols-3 gap-4">
                                    <span className="text-gray-800 font-semibold">
                                      {part.name}
                                    </span>
                                    <span className="text-gray-700">
                                      {part.part_number}
                                    </span>
                                    <span className="text-gray-700">
                                      {part.location}
                                    </span>
                                  </div>
                                </div>
                                {isAuthorized && (
                                  <div className="mt-2 flex space-x-3">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEdit(part);
                                      }}
                                      className="px-5 py-3 bg-yellow-300 hover:bg-yellow-400 text-gray-800 rounded text-lg"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(part);
                                      }}
                                      className="px-5 py-3 bg-red-500 hover:bg-red-600 text-white rounded text-lg"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </li>
                        ))}
                      </ul>

                      {/* Pagination Controls */}
                      <div className="flex justify-between items-center mt-4">
                        <button
                          disabled={page === 1}
                          onClick={() =>
                            setPage((prev) => Math.max(1, prev - 1))
                          }
                          className={`px-5 py-3 rounded text-lg ${
                            page === 1
                              ? "bg-gray-300"
                              : "bg-blue-500 text-white"
                          }`}
                        >
                          Previous
                        </button>
                        <span className="text-gray-700">
                          Page {page} of {totalPages}
                        </span>
                        <button
                          disabled={page >= totalPages}
                          onClick={() =>
                            setPage((prev) => Math.min(totalPages, prev + 1))
                          }
                          className={`px-5 py-3 rounded text-lg ${
                            page >= totalPages
                              ? "bg-gray-300"
                              : "bg-blue-500 text-white"
                          }`}
                        >
                          Next
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Splash fallback for overlapping layer */}
      {showSplash && (
        <div className="absolute inset-0 z-50">
          <SplashScreen onFinish={() => setShowSplash(false)} />
        </div>
      )}

      {/* Confirmation Modal (solid black overlay) */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm w-[92%]">
            <p className="mb-4">{confirmMessage}</p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => {
                  confirmCallback();
                  setConfirmOpen(false);
                }}
                className="btn-red text-lg px-6 py-3"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmOpen(false)}
                className="btn-gray text-lg px-6 py-3"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Simple popup modal (for validation / PIN / error messages) */}
      {popupMessage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-70">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm w-[92%]">
            <p className="mb-4">{popupMessage}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setPopupMessage("")}
                className="btn-blue text-lg px-6 py-3"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
