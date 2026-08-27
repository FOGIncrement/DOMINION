import { useEffect, useState } from "react";
import type { Announcement } from "../types.js";

export default function AnnouncementsFeed() {
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.dominion.getAnnouncements().then((result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAnnouncements(result.data);
    });
  }, []);

  return (
    <div className="card">
      <h2 className="card__title">Announcements</h2>
      {error && <div className="auth-error">{error}</div>}
      {!error && announcements === null && <div className="loading">Loading...</div>}
      {!error && announcements?.length === 0 && <div className="empty-state">No announcements yet.</div>}
      {announcements?.map((a) => (
        <div key={a.id} className="announcement">
          <p className="announcement__title">{a.title}</p>
          <p className="announcement__body">{a.body}</p>
          <p className="announcement__meta">{new Date(a.createdAt).toLocaleDateString()}</p>
        </div>
      ))}
    </div>
  );
}
