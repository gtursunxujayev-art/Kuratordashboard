import SharedReportClient from './shared-report-client';

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedReportClient token={token} />;
}
