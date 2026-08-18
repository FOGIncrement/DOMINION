import { useNews } from "../api/hooks.js";

export default function News() {
  const { data, isLoading } = useNews();

  return (
    <div className="page page--full">
      <div className="card">
        <h2 className="card__title">World News</h2>
        {isLoading || !data ? (
          <div className="loading">Loading news...</div>
        ) : data.events.length === 0 ? (
          <div className="empty-state">Nothing has happened yet. Check back soon.</div>
        ) : (
          data.events.map((event) => (
            <div className="news-item" key={event.id}>
              <div className="news-item__title">{event.title}</div>
              <div>{event.description}</div>
              <div className="news-item__meta">
                {event.settlementName ?? "World"} · {new Date(event.occurredAt).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
