import LogViewer from '@/components/log-viewer';

export default function LogPage({ params }) {
  return <LogViewer appName={params.appName} />;
}
