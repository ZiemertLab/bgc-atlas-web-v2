'use client';

import { apiFetch } from "@/lib/basePath";
import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function SampleRedirectPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;

    useEffect(() => {
        async function redirect() {
            try {
                const response = await apiFetch(`/api/samples/${id}/source-types`);

                if (!response.ok) {
                    console.warn(`Sample ${id} not found, redirecting to /samples`);
                    router.replace('/samples');
                    return;
                }

                const data = await response.json();
                const sourceTypes = data.sourceTypes || [];

                const isGenomeCollection = sourceTypes.some((type: string) =>
                    ['isolate', 'MAG', 'SAG'].includes(type)
                );

                if (isGenomeCollection) {
                    router.replace(`/genome-collections?id=${id}`);
                } else {
                    router.replace(`/samples?id=${id}`);
                }
            } catch (error) {
                console.error('Failed to redirect sample:', error);
                router.replace('/samples');
            }
        }

        redirect();
    }, [id, router]);

    return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                <p className="text-muted-foreground">Loading sample details...</p>
            </div>
        </div>
    );
}
