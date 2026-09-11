"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ResponseData {
  id: string;
  draftText: string;
  finalText: string | null;
  generatedAt: string;
  llmModel: string | null;
  llmTokensUsed: number | null;
}

interface ResponseEditorProps {
  reviewId: string;
  response: ResponseData | null;
  reviewStatus: string;
}

export default function ResponseEditor({
  reviewId,
  response,
  reviewStatus,
}: ResponseEditorProps) {
  const router = useRouter();
  const [text, setText] = useState(
    response?.finalText ?? response?.draftText ?? ""
  );
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isActionable = ["pending", "draft_ready"].includes(reviewStatus);
  const hasUnsavedChanges =
    text !== (response?.finalText ?? response?.draftText ?? "");

  async function handleAction(action: string) {
    setLoading(action);
    setMessage(null);
    try {
      let res: Response;

      if (action === "approve") {
        res = await fetch(`/api/reviews/${reviewId}/approve`, {
          method: "POST",
        });
      } else if (action === "reject") {
        res = await fetch(`/api/reviews/${reviewId}/reject`, {
          method: "POST",
        });
      } else if (action === "regenerate") {
        res = await fetch(`/api/reviews/${reviewId}/regenerate`, {
          method: "POST",
        });
      } else if (action === "save") {
        res = await fetch(`/api/reviews/${reviewId}/response`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ responseId: response!.id, text }),
        });
      } else {
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Request failed");
      }

      setMessage({
        type: "success",
        text:
          action === "approve"
            ? "Response approved"
            : action === "reject"
              ? "Review rejected"
              : action === "regenerate"
                ? "New draft generated"
                : "Changes saved",
      });
      setIsEditing(false);
      router.refresh();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setLoading(null);
    }
  }

  if (!response) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No AI response generated yet.
        </p>
        {reviewStatus === "pending" && (
          <button
            onClick={() => handleAction("regenerate")}
            disabled={loading !== null}
            className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading === "regenerate" ? "Generating..." : "Generate Response"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          AI Response
        </h3>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {response.llmModel && <span>{response.llmModel}</span>}
          {response.llmTokensUsed && (
            <span>{response.llmTokensUsed} tokens</span>
          )}
        </div>
      </div>

      {isEditing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
      ) : (
        <div
          className="cursor-pointer rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300"
          onClick={() => isActionable && setIsEditing(true)}
          title={isActionable ? "Click to edit" : undefined}
        >
          {response.finalText ?? response.draftText}
        </div>
      )}

      {message && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {isActionable && (
        <div className="flex flex-wrap gap-2">
          {isEditing && (
            <>
              <button
                onClick={() => handleAction("save")}
                disabled={loading !== null || !hasUnsavedChanges}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {loading === "save" ? "Saving..." : "Save Edit"}
              </button>
              <button
                onClick={() => {
                  setText(response.finalText ?? response.draftText);
                  setIsEditing(false);
                }}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          )}
          {!isEditing && (
            <>
              <button
                onClick={() => handleAction("approve")}
                disabled={loading !== null}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {loading === "approve" ? "Approving..." : "Approve"}
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Edit
              </button>
              <button
                onClick={() => handleAction("regenerate")}
                disabled={loading !== null}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {loading === "regenerate" ? "Regenerating..." : "Regenerate"}
              </button>
              <button
                onClick={() => handleAction("reject")}
                disabled={loading !== null}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                {loading === "reject" ? "Rejecting..." : "Reject"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
