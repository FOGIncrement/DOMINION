import { useWorldSettlements } from "../api/hooks.js";

export default function World() {
  const { data, isLoading } = useWorldSettlements();

  return (
    <div className="page page--full">
      <div className="card">
        <h2 className="card__title">Settlements of the World</h2>
        {isLoading || !data ? (
          <div className="loading">Loading world...</div>
        ) : data.settlements.length === 0 ? (
          <div className="empty-state">No other settlements yet.</div>
        ) : (
          <table className="settlement-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Archetype</th>
                <th>Population</th>
                <th>Gold</th>
                <th>Founded</th>
              </tr>
            </thead>
            <tbody>
              {data.settlements.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.archetypeName && <span className="archetype-tag">{s.archetypeName}</span>}</td>
                  <td>{s.population.toLocaleString()}</td>
                  <td>{s.gold.toLocaleString()}</td>
                  <td>{new Date(s.foundedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
