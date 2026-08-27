import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../api/client.js";
import { useAnnouncements } from "../api/hooks.js";

function invalidateAnnouncements(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["announcements"] });
}

function PostAnnouncementForm() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: () => api.adminCreateAnnouncement(title.trim(), body.trim()),
    onSuccess: () => {
      setError(null);
      setTitle("");
      setBody("");
      invalidateAnnouncements(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't post announcement"),
  });

  return (
    <div className="card">
      <h2 className="card__title">Post an Announcement</h2>
      <p className="suggestion" style={{ marginBottom: 12 }}>
        Shown newest-first in the desktop launcher's Hub screen, and to anyone hitting the public announcements feed.
      </p>
      {error && <div className="auth-error">{error}</div>}
      <div className="field">
        <label htmlFor="announcement-title">Title</label>
        <input id="announcement-title" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="announcement-body">Body</label>
        <textarea
          id="announcement-body"
          rows={4}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            borderRadius: "var(--radius-control)",
            padding: "8px 10px",
            font: "inherit",
            resize: "vertical",
          }}
        />
      </div>
      <button
        className="btn btn--accent"
        disabled={!title.trim() || !body.trim() || post.isPending}
        onClick={() => post.mutate()}
      >
        Post
      </button>
    </div>
  );
}

function AnnouncementsList() {
  const queryClient = useQueryClient();
  const { data } = useAnnouncements();
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.adminDeleteAnnouncement(id),
    onSuccess: () => {
      setError(null);
      invalidateAnnouncements(queryClient);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Couldn't delete"),
  });

  const announcements = data?.announcements ?? [];

  if (announcements.length === 0) {
    return (
      <div className="card">
        <h2 className="card__title">Posted Announcements</h2>
        <div className="empty-state">No announcements yet — post the first one above.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="card__title">Posted Announcements</h2>
      {error && <div className="auth-error">{error}</div>}
      {announcements.map((a) => (
        <div key={a.id} className="admin-config-card" style={{ marginBottom: 10 }}>
          <div className="admin-config-card__header">
            <span>{a.title}</span>
            <button className="btn btn--danger" disabled={remove.isPending} onClick={() => remove.mutate(a.id)}>
              Delete
            </button>
          </div>
          <p className="suggestion" style={{ margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{a.body}</p>
          <p className="suggestion" style={{ margin: 0, fontSize: 11 }}>
            {a.authorEmail} · {new Date(a.createdAt).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function AdminAnnouncements() {
  return (
    <div className="page page--full">
      <PostAnnouncementForm />
      <AnnouncementsList />
    </div>
  );
}
