export function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <div className="loading-orbit">
        <span />
        <span />
        <span />
      </div>
      <p>Opening observatory channel...</p>
    </div>
  );
}
