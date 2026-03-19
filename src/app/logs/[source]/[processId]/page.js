import LogViewer from '@/components/log-viewer';

export default function LogPage({ params }) {
  return <LogViewer source={params.source} processId={decodeURIComponent(params.processId)} />;
}
