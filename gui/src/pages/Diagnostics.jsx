import { api } from '../services/api.js';
import { usePoll } from '../hooks/usePoll.js';
import {
  CodeBlock,
  ErrorBanner,
  PageHeader,
} from '../components/ui.jsx';

export default function Diagnostics() {
  const { data, error, loading } = usePoll(() => api.diagnostics(), 3000);

  if (error) {
    return <ErrorBanner>Agent unreachable: {error}</ErrorBanner>;
  }

  return (
    <>
      <PageHeader
        title="Diagnostics"
        description="Raw diagnostic payload from the agent API. Refreshes every 3 seconds."
      />

      {loading && !data ? (
        <div className="code-block">Loading diagnostics...</div>
      ) : (
        <CodeBlock>{JSON.stringify(data, null, 2)}</CodeBlock>
      )}
    </>
  );
}
