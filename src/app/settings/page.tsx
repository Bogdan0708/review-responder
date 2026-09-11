"use client";

import { useEffect, useState } from "react";

interface Settings {
  brand_voice?: { systemPrompt: string; menuHighlights: string[] };
  auto_approve?: { enabled: boolean };
  llm_provider?: { primary: string; fallback: string; local: string };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [brandPrompt, setBrandPrompt] = useState("");
  const [menuHighlights, setMenuHighlights] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [llmPrimary, setLlmPrimary] = useState("claude");
  const [llmFallback, setLlmFallback] = useState("openai");
  const [llmLocal, setLlmLocal] = useState("lm-studio");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        setSettings(data);
        setBrandPrompt(data.brand_voice?.systemPrompt ?? "");
        setMenuHighlights(
          (data.brand_voice?.menuHighlights ?? []).join(", ")
        );
        setAutoApprove(data.auto_approve?.enabled ?? false);
        setLlmPrimary(data.llm_provider?.primary ?? "claude");
        setLlmFallback(data.llm_provider?.fallback ?? "openai");
        setLlmLocal(data.llm_provider?.local ?? "lm-studio");
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function saveSetting(key: string, value: unknown) {
    setSaving(key);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setMessage({ type: "success", text: `${key.replace(/_/g, " ")} updated` });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-400" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Settings
      </h1>

      {message && (
        <div
          className={`mb-4 rounded-lg px-4 py-2 text-sm ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* Brand Voice */}
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Brand Voice
          </h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                System Prompt
              </label>
              <textarea
                value={brandPrompt}
                onChange={(e) => setBrandPrompt(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="Describe how the AI should respond to reviews..."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Menu Highlights
              </label>
              <input
                type="text"
                value={menuHighlights}
                onChange={(e) => setMenuHighlights(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                placeholder="Mici, Sarmale, Papanasi (comma-separated)"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Comma-separated list of menu items to detect in reviews
              </p>
            </div>
            <button
              onClick={() =>
                saveSetting("brand_voice", {
                  systemPrompt: brandPrompt,
                  menuHighlights: menuHighlights
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              disabled={saving === "brand_voice"}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {saving === "brand_voice" ? "Saving..." : "Save Brand Voice"}
            </button>
          </div>
        </section>

        {/* Auto-Approve */}
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Auto-Approve
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Automatically approve responses for positive reviews (4-5 stars)
                without food safety concerns.
              </p>
            </div>
            <button
              onClick={() => {
                const newVal = !autoApprove;
                setAutoApprove(newVal);
                saveSetting("auto_approve", { enabled: newVal });
              }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                autoApprove ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  autoApprove ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </section>

        {/* LLM Provider */}
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            LLM Provider
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                label: "Primary",
                value: llmPrimary,
                set: setLlmPrimary,
              },
              {
                label: "Fallback",
                value: llmFallback,
                set: setLlmFallback,
              },
              {
                label: "Local",
                value: llmLocal,
                set: setLlmLocal,
              },
            ].map((field) => (
              <div key={field.label}>
                <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {field.label}
                </label>
                <select
                  value={field.value}
                  onChange={(e) => field.set(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="claude">Claude</option>
                  <option value="openai">OpenAI</option>
                  <option value="lm-studio">LM Studio</option>
                </select>
              </div>
            ))}
          </div>
          <button
            onClick={() =>
              saveSetting("llm_provider", {
                primary: llmPrimary,
                fallback: llmFallback,
                local: llmLocal,
              })
            }
            disabled={saving === "llm_provider"}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {saving === "llm_provider" ? "Saving..." : "Save Provider Config"}
          </button>
        </section>

        {/* API Keys (display only) */}
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            API Keys
          </h2>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            API keys are configured via environment variables for security.
          </p>
          <div className="space-y-2">
            {["CLAUDE_API_KEY", "OPENAI_API_KEY", "LM_STUDIO_URL"].map(
              (name) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded border border-zinc-100 px-3 py-2 dark:border-zinc-800"
                >
                  <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                    {name}
                  </span>
                  <span className="text-xs text-zinc-400">Set in .env</span>
                </div>
              )
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
