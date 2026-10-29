import type { Metadata } from 'next';
import { PublicCertificateVerifier } from '@/components/certificate/PublicCertificateVerifier';

interface PageProps {
  params: Promise<{ certId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const shortId = params.certId ? `${params.certId.slice(0, 10)}...` : 'Document';
  return {
    title: `Verify Certificate ${shortId} | CertProof`,
    description: 'Public zero-auth cryptographic certificate verification on Ethereum.',
  };
}

export default async function VerifyCertificatePage(props: PageProps) {
  const params = await props.params;
  const rawSearchParams = props.searchParams ? await props.searchParams : undefined;
  const normalizedSearchParams: { [key: string]: string | undefined } = {};
  if (rawSearchParams) {
    for (const key of Object.keys(rawSearchParams)) {
      const val = rawSearchParams[key];
      if (typeof val === 'string') {
        normalizedSearchParams[key] = val;
      } else if (Array.isArray(val) && val.length > 0) {
        normalizedSearchParams[key] = val[0];
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col justify-start">
      <PublicCertificateVerifier
        certId={params.certId}
        initialSearchParams={normalizedSearchParams}
      />
    </div>
  );
}
