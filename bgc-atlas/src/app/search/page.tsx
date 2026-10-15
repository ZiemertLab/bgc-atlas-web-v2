"use client";

import { apiFetch, downloadFromApi } from "@/lib/basePath";
import { useState, useRef, useEffect } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PropertySearchTab } from '@/components/search/property-search-tab';
import { Upload, Play, X, Trash2, Loader2, Clock, ChevronDown } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { toast } from '@/lib/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { getStoredJobs, storeJob, removeJob, clearAllJobs, type JobInfo } from '@/lib/utils/job-cookies';
import { looksLikeGenbank } from '@/lib/seqsearch/genbank';
import { SEARCH_DEFAULTS } from '@/lib/seqsearch/defaults';
import { FileDropZone } from '@/components/ui/file-drop-zone';

const SEQUENCE_FILE_EXTENSIONS = [
  '.fa', '.fasta', '.fas', '.txt',
  '.gbk', '.genbank', '.gbff',
] as const;
const SEQUENCE_FILE_ACCEPT = [...SEQUENCE_FILE_EXTENSIONS, 'text/*'].join(',');

// The closest the File API gets to identity; enough to keep a re-pick from queueing a file twice.
const fileIdentity = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

// Counts only: job ids belong to whoever submitted them, and this page is public.
type QueueStatsViewModel = {
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
};

/**
 * What "antiSMASH(-compatible) GenBank files" means, on the BiG-SLiCE tab. The "Not"
 * list is what uploaders sent instead; the submit route rejects each of them with its
 * own message (lib/bigslice/genbank-usability.ts).
 */
const GENBANK_UPLOAD_HELP = (
  <>
    <p>
      The regionNNN.gbk files antiSMASH (5 or later) writes, one gene cluster per file,
      uploaded as antiSMASH wrote them.
    </p>
    <p className="mt-1.5">
      <strong className="font-bold text-destructive-on-primary">Not:</strong> GenBank that never went
      through antiSMASH (from NCBI, Prokka or Bakta); antiSMASH files edited and re-exported
      in SnapGene, Geneious or similar software, which can drop the annotations BiG-SLiCE
      reads; MIBiG GenBank downloads whose antiSMASH block says &lsquo;Version :: False&rsquo;;
      FASTA; or a whole-genome .gbk. To search a single gene or protein, use Sequence
      similarity.
    </p>
  </>
);

export default function SearchPage() {
  const [activeTab, setActiveTab] = useState('properties');
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    // 'metadata' was folded into this tab; keep old links working.
    if (tab === 'metadata') {
      setActiveTab('properties');
    } else if (tab && ['bgc', 'sequence', 'properties'].includes(tab)) {
      setActiveTab(tab);
    }
  }, []);
  const [, setMounted] = useState(false);
  const [sequenceText, setSequenceText] = useState('')
  // GenBank input only; ignored for FASTA.
  const [genbankMode, setGenbankMode] = useState<'cds' | 'contig'>('cds');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [queueStats, setQueueStats] = useState<QueueStatsViewModel | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const genbankFileInputRef = useRef<HTMLInputElement>(null);

  // Thresholds from SEARCH_DEFAULTS so the form shows the floor the submit route applies.
  const [sequenceParams, setSequenceParams] = useState({
    eValue: SEARCH_DEFAULTS.eValue,
    minIdentity: SEARCH_DEFAULTS.identity,
    minCoverage: SEARCH_DEFAULTS.coverage,
    algorithm: 'diamond',
    sequenceType: 'auto',
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    acceptSequenceFiles(Array.from(event.target.files ?? []));
  };

  // Shared by the file picker and the drop zone, so both apply the same checks.
  const acceptSequenceFiles = (files: File[]) => {
    const file = files[0];
    if (file) {
      // A .gbk usually arrives with an empty MIME type, so the extension is what counts.
      const fileName = file.name.toLowerCase();
      const isValidFile =
        SEQUENCE_FILE_EXTENSIONS.some((ext) => fileName.endsWith(ext)) ||
        file.type.startsWith('text/');

      if (!isValidFile) {
        toast({
          variant: 'destructive',
          title: 'Invalid file',
          description: `Please select a FASTA or GenBank file (${SEQUENCE_FILE_EXTENSIONS.join(', ')}).`,
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setSequenceText(content);
      };
      reader.readAsText(file);
    }
  };

  const loadExampleSequence = () => {
    const exampleSequence = `>example_protein
MRQRQMCIRDRPTPRPQLPFLATTSFRSQRHARLQQQLNRYLSTDTKRWLKDQVKLGMKY
TLYGWTAMFLISIMLIGYYIERADRSYPSPNEWSWGSKHLYRRARSEEEEDVTEWEGRGI
VDWARVQSTWLNLLPRLEDPTIEGKGVLPLETPPEAGVPQAVLEDLGIAAFDVSSKSEEW
IRAYYTVLMGIAKAAERLQDDVKDMKRYTVWPKDMVIGPSNPNPRPVPPGSPPAPFEEDV
LPASEPPETYYNKILLTKGFSTRQRLEAALAYADWLDFSGKSESAEDIYKWAVNVAVSGL
ASSTSTSKVIDSNFVLQPSAQPSSNLITAVTALAIHHARQQNISAALPMFISVLRARREA
PLVDSPKKTWRPTTQDAPMDALRWYVQKSFTPAKFPPPPPTGNTPLVRTPSDECEEAAVM
MYIGEILYASDEDLEKGKKKGKGVGERESGINYTRQAHMLALDRARDAETEVGQREKCLQ
CADASLKNLHAMVQRLAREERARSGPKPGATVLATSTSTSLPTWPSEATVSTTTGEEKER
RKSSWLSWWASEDNALGDAGEGEAGEGRWTREEREVEEMVRKEAREGLWEMVQAQKRPFG
WFGVHS`;
    setSequenceText(exampleSequence);
  };

  const handleGenbankUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    acceptGenbankFiles(Array.from(event.target.files || []));
    // Re-picking the same file fires no change event unless the input is cleared; the File
    // objects are already copied out of the FileList, so clearing is safe.
    event.target.value = '';
  };

  const acceptGenbankFiles = (files: File[]) => {
    if (files.length > 0) {
      const validExtensions = ['.gbk', '.genbank', '.gbff'];
      const invalidFiles = files.filter(file => {
        const fileName = file.name.toLowerCase();
        return !validExtensions.some(ext => fileName.endsWith(ext));
      });

      if (invalidFiles.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Invalid files',
          description: 'Please select valid GenBank files (.gbk, .genbank, or .gbff).',
        });
        return;
      }

      // Add to the selection rather than replace it; removal stays explicit.
      setUploadedFiles(existing => {
        const seen = new Set(existing.map(fileIdentity));
        const added = files.filter(file => {
          const identity = fileIdentity(file);
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
        return added.length > 0 ? [...existing, ...added] : existing;
      });
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(files => files.filter((_, i) => i !== index));
  };

  const clearAllFiles = () => {
    setUploadedFiles([]);
    if (genbankFileInputRef.current) {
      genbankFileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchQueueStats = async () => {
    try {
      const response = await apiFetch('/api/search/queue');
      const result = await response.json();
      
      if (result.success) {
        setQueueStats(result.data);
      }
    } catch {
      // Queue stats are cosmetic and polled every 5s; silent fail.
    }
  };

  const router = useRouter();
  const [sessionIdInput, setSessionIdInput] = useState('')
  const [oldError, setOldError] = useState<string | null>(null)
  const [storedSessions, setStoredSessions] = useState<JobInfo[]>([])
  const [showSequenceAdvanced, setShowSequenceAdvanced] = useState(false)

  const openJobResults = (jobId: string) => {
    router.push(`/search/results/${jobId}`);
  };

  // GBK export jobs have no results page; re-download their zip.
  const downloadGbkJob = async (jobId: string) => {
    try {
      const statusRes = await apiFetch(`/api/search/properties/export-gbk/${jobId}`);
      const status = await statusRes.json();
      if (!statusRes.ok || status.error) {
        toast({ variant: 'destructive', title: 'Export unavailable', description: 'This GBK export is no longer available.' });
        return;
      }
      if (status.state === 'failed') {
        toast({ variant: 'destructive', title: 'Export failed', description: 'This GBK export did not complete.' });
        return;
      }
      if (status.state !== 'completed') {
        toast({ title: 'Still processing', description: 'This GBK export is still being built — try again shortly.' });
        return;
      }
      downloadFromApi(`/api/search/properties/export-gbk/${jobId}/download`);
    } catch {
      toast({ variant: 'destructive', title: 'Download failed', description: 'Could not download the GBK export.' });
    }
  };

  const isGbkJob = (session: JobInfo) => session.type === 'export' || session.type === 'property-gbk';

  const openJob = (session: JobInfo) => {
    if (session.type === 'export') router.push(`/exports/${session.id}`);
    else if (session.type === 'property-gbk') downloadGbkJob(session.id);
    else openJobResults(session.id);
  };

  const handleClearAllSessions = () => {
    clearAllJobs();
    setStoredSessions([]);
  };

  const handleRemoveSession = (jobId: string) => {
    removeJob(jobId);
    setStoredSessions(getStoredJobs());
  };

  const fetchOldResults = () => {
    const id = sessionIdInput.trim()
    if (!id) {
      setOldError('Please enter a Job ID')
      return
    }
    setOldError(null)
    router.push(`/search/results/${encodeURIComponent(id)}`)
  }

  useEffect(() => {
    fetchQueueStats();
    
    setStoredSessions(getStoredJobs());
    
    const statsInterval = setInterval(fetchQueueStats, 5000);

    // Another tab (e.g. the property GBK export) may store a job.
    const onJobsUpdated = () => setStoredSessions(getStoredJobs());
    window.addEventListener('bgc-jobs-updated', onJobsUpdated);

    return () => {
      clearInterval(statsInterval);
      window.removeEventListener('bgc-jobs-updated', onJobsUpdated);
    };
  }, []);

  const handleSequenceSearch = async () => {
    if (!sequenceText.trim()) {
      toast({
        variant: 'destructive',
        title: 'Sequence required',
        description: 'Please provide a sequence to search.',
      });
      return;
    }

    setIsUploading(true);
    // yield to the browser so the UI can update and show the status/banner
    await new Promise((r) => setTimeout(r, 0));
    try {
      const formData = new FormData();
      formData.append('sequence', sequenceText.trim());
      formData.append('sequenceType', sequenceParams.sequenceType);
      if (looksLikeGenbank(sequenceText)) formData.append('queryMode', genbankMode);
      formData.append('algorithm', sequenceParams.algorithm);
      formData.append('eValue', sequenceParams.eValue);
      formData.append('minIdentity', sequenceParams.minIdentity.toString());
      formData.append('minCoverage', sequenceParams.minCoverage.toString());

      const response = await apiFetch('/api/search/sequence/submit', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        const sessionId = result.sessionId;
        storeJob(sessionId, 'sequence');
        setStoredSessions(getStoredJobs());

        router.push(`/search/results/${sessionId}`);
      } else {
        toast({
          variant: 'destructive',
          title: 'Search failed',
          description: result.error ?? 'Unknown error.',
        });
        setIsUploading(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start sequence search. Please try again.';
      toast({
        variant: 'destructive',
        title: 'Search failed',
        description: message,
      });
      setIsUploading(false);
    }
  };

  const handleBGCSearch = async () => {
    if (uploadedFiles.length === 0) {
      toast({
        variant: 'destructive',
        title: 'No files',
        description: 'Please upload at least one GenBank file.',
      });
      return;
    }

    const totalSize = uploadedFiles.reduce((sum, file) => sum + file.size, 0);
    const maxSize = 500 * 1024 * 1024;
    const maxFiles = 100;

    if (uploadedFiles.length > maxFiles) {
      toast({
        variant: 'destructive',
        title: 'Too many files',
        description: `Maximum ${maxFiles} files allowed.`,
      });
      return;
    }

    if (totalSize > maxSize) {
      toast({
        variant: 'destructive',
        title: 'Files too large',
        description: 'Total file size exceeds 500 MB. Please reduce the number or size of files.',
      });
      return;
    }

    setIsUploading(true);
    // yield to the browser so the UI can update and show the status/banner
    await new Promise((r) => setTimeout(r, 0));
    try {
      const formData = new FormData();

      uploadedFiles.forEach(file => {
        formData.append('files', file);
      });

      const response = await apiFetch('/api/search/bigslice/submit', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        const sessionId = result.sessionId;

        storeJob(sessionId, 'bgc');
        setStoredSessions(getStoredJobs());
        router.push(`/search/results/${sessionId}`);
      } else {
        toast({
          variant: 'destructive',
          title: 'Upload failed',
          description: result.error ?? 'Unknown error.',
        });
        setIsUploading(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start BGC search. Please try again.';
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: message,
      });
      setIsUploading(false);
    }
  };

  return (
    <MainLayout>
      <div className="w-full py-6">
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Advanced search
          </h1>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
            Explore biosynthetic gene clusters by their properties, metadata, sequence similarity
            (DIAMOND), or BiG-SLiCE searches to find GCFs that are similar to your query.
          </p>
        </header>

        <section className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-2.5">Queue status</div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Running</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {queueStats?.active ?? 0}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">In queue</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {queueStats?.waiting ?? 0}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Completed</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {(queueStats?.completed ?? 0).toLocaleString()}
              </dd>
            </div>
          </dl>
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-6 w-full justify-start">
            <TabsTrigger value="properties">Properties &amp; metadata</TabsTrigger>
            <TabsTrigger value="bgc">BGC clustering</TabsTrigger>
            <TabsTrigger value="sequence">Sequence similarity</TabsTrigger>
          </TabsList>

          <TabsContent value="bgc" className="space-y-4">
            <p className="mb-3 text-base text-muted-foreground">
              Upload{' '}
              <InfoTooltip content={GENBANK_UPLOAD_HELP} wide>
                antiSMASH(-compatible) GenBank files
              </InfoTooltip>{' '}
              to match them against the
              atlas&rsquo;s gene cluster families with BiG-SLiCE, which compares clusters by their
              biosynthetic and Pfam domain content rather than by sequence identity. Each query
              returns its three nearest families with a distance; a distance at or below 0.4 —
              the threshold the atlas was clustered at — makes the BGC a member of that family,
              and anything beyond it is the nearest family, not a match.
            </p>
            <div className="border border-border bg-card p-5">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">GenBank files</label>
                  <FileDropZone
                    onFiles={acceptGenbankFiles}
                    className="border border-dashed border-border bg-muted/20 px-4 py-5 text-center transition-colors"
                  >
                    <p className="mb-3 text-[12.5px] text-muted-foreground">
                      Drag files here, or browse. One or multiple{" "}
                      <span className="font-mono">.gbk</span> /{" "}
                      <span className="font-mono">.genbank</span> /{" "}
                      <span className="font-mono">.gbff</span> files
                    </p>
                    <input
                      ref={genbankFileInputRef}
                      type="file"
                      accept=".gbk,.genbank,.gbff"
                      multiple
                      onChange={handleGenbankUpload}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => genbankFileInputRef.current?.click()}
                    >
                      <Upload className="size-3.5" />
                      Select files
                    </Button>
                  </FileDropZone>
                </div>

                {uploadedFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Uploaded ({uploadedFiles.length})
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllFiles}
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Trash2 className="size-3" />
                        Clear all
                      </Button>
                    </div>
                    <ul className="max-h-32 space-y-px overflow-y-auto border border-border bg-muted/20 p-2">
                      {uploadedFiles.map((file, index) => (
                        <li
                          key={fileIdentity(file)}
                          className="flex items-center justify-between bg-card px-2 py-1 font-mono text-[12px]"
                        >
                          <span className="flex-1 truncate text-foreground">{file.name}</span>
                          <div className="ml-2 flex items-center gap-2">
                            <span className="text-[10.5px] tabular-nums text-muted-foreground">
                              {(file.size / 1024).toFixed(1)} KB
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFile(index)}
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                              aria-label={`Remove ${file.name}`}
                            >
                              <X className="size-3" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    className="w-full"
                    disabled={uploadedFiles.length === 0 || isUploading}
                    onClick={handleBGCSearch}
                  >
                    {isUploading ? 'Uploading…' : 'Run BiG-SLiCE clustering'}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sequence" className="space-y-4">
            <p className="mb-3 text-base text-muted-foreground">
              Paste a protein or nucleotide FASTA query, or upload a FASTA file or a GenBank file
              of a whole region, to align it with DIAMOND against the protein sequences of every
              BGC in the atlas — blastp for a protein query, translated blastx for a nucleotide
              one. Hits come back grouped by the BGC they landed in, capped at the best 1,000
              alignments and cut off by default at an E-value of 1e-5, 50% identity and 80%
              coverage — Advanced options changes those three thresholds.
            </p>
            <div className="border border-border bg-card p-5">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Input sequence
                  </label>
                  {/* Without the wrapper's preventDefault the browser navigates to a dropped file
                      and discards whatever was typed. */}
                  <FileDropZone
                    onFiles={acceptSequenceFiles}
                    single
                    className="rounded-sm border border-transparent transition-colors"
                  >
                  <textarea
                    value={sequenceText}
                    onChange={(e) => setSequenceText(e.target.value)}
                    className="min-h-[200px] w-full rounded-sm border border-input bg-card px-3 py-2 font-mono text-[12.5px] text-foreground transition-[color,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-foreground focus-visible:ring-[2px] focus-visible:ring-ring/30"
                    // An expression, not a multi-line attribute string: JSX folds the line
                    // breaks of the latter into spaces, which ran the FASTA onto one line.
                    placeholder={[
                      '>query_protein',
                      'MRQRQMCIRDRPTPRPQLPFLATTSFRSQRHARLQQQLNRYLSTDTKRWLKDQVKLGMKY',
                      'TLYGWTAMFLISIMLIGYYIERADRSYPSPNEWSWGSKHLYRRARSEEEED...',
                    ].join('\n')}
                  />
                  </FileDropZone>
                </div>

                {looksLikeGenbank(sequenceText) && (
                  <div className="rounded-sm border border-border bg-muted/30 px-3 py-2 text-xs">
                    <div className="mb-1.5 font-medium text-foreground">GenBank record detected</div>
                    <label className="flex cursor-pointer items-start gap-2 py-0.5 text-muted-foreground">
                      <input
                        type="radio"
                        name="genbankMode"
                        checked={genbankMode === 'cds'}
                        onChange={() => setGenbankMode('cds')}
                        className="mt-0.5 accent-brand"
                      />
                      <span>
                        <span className="text-foreground">Search the annotated CDS translations</span>
                        {' — '}uses the file&apos;s own gene calls, so hits are attributed to a named
                        gene and the results map shows your genes.
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 py-0.5 text-muted-foreground">
                      <input
                        type="radio"
                        name="genbankMode"
                        checked={genbankMode === 'contig'}
                        onChange={() => setGenbankMode('contig')}
                        className="mt-0.5 accent-brand"
                      />
                      <span>
                        <span className="text-foreground">Search the nucleotide sequence</span>
                        {' — '}translates the record in six frames instead. Slower, and gene
                        boundaries are inferred rather than read from the file.
                      </span>
                    </label>
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SEQUENCE_FILE_ACCEPT}
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-3.5" />
                    Upload FASTA or GenBank
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadExampleSequence}
                  >
                    <Play className="size-3.5" />
                    Load example
                  </Button>
                </div>

                <div className="border border-border bg-muted/15 p-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setShowSequenceAdvanced(prev => !prev)}
                    aria-expanded={showSequenceAdvanced}
                  >
                    <span>Advanced options</span>
                    <ChevronDown className={`size-3.5 transition-transform ${showSequenceAdvanced ? 'rotate-180' : ''}`} />
                  </button>
                  {showSequenceAdvanced && (
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Sequence type</label>
                          <select
                            className="h-8 w-full rounded-sm border border-input bg-card px-2 text-[13px]"
                            value={sequenceParams.sequenceType}
                            onChange={(e) => setSequenceParams(prev => ({ ...prev, sequenceType: e.target.value }))}
                          >
                            <option value="auto">Auto-detect</option>
                            <option value="dna">Nucleotide (blastx)</option>
                            <option value="protein">Protein (blastp)</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Search algorithm</label>
                            <InfoTooltip content="Protein queries are aligned with DIAMOND blastp, nucleotide queries with DIAMOND blastx against the same protein database." />
                          </div>
                          <div className="flex h-8 w-full items-center rounded-sm border border-input bg-muted/40 px-2 text-[13px] text-muted-foreground">
                            DIAMOND (blastp / blastx)
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">E-value</label>
                            <InfoTooltip content="Expectation value. The number of hits one can expect to see by chance when searching a database of a particular size." />
                          </div>
                          <Input
                            placeholder={SEARCH_DEFAULTS.eValue}
                            value={sequenceParams.eValue}
                            onChange={(e) => setSequenceParams(prev => ({ ...prev, eValue: e.target.value }))}
                            className="h-8 text-[13px]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Identity %</label>
                            <InfoTooltip content="Percentage of exact matches between the query and the target sequence." />
                          </div>
                          <Input
                            placeholder={String(SEARCH_DEFAULTS.identity)}
                            type="number"
                            value={sequenceParams.minIdentity}
                            onChange={(e) => setSequenceParams(prev => ({ ...prev, minIdentity: Number(e.target.value) }))}
                            className="h-8 text-[13px]"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1">
                            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Coverage %</label>
                            <InfoTooltip content="Minimum fraction of the input sequence(s) that must be covered by the alignment." />
                          </div>
                          <Input
                            placeholder={String(SEARCH_DEFAULTS.coverage)}
                            type="number"
                            value={sequenceParams.minCoverage}
                            onChange={(e) => setSequenceParams(prev => ({ ...prev, minCoverage: Number(e.target.value) }))}
                            className="h-8 text-[13px]"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <Button
                    className="w-full"
                    disabled={!sequenceText.trim() || isUploading}
                    onClick={handleSequenceSearch}
                  >
                    {isUploading ? 'Uploading…' : 'Run sequence search'}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="properties" className="space-y-4">
            <PropertySearchTab />
          </TabsContent>
        </Tabs>

        {isUploading && (
          <div className="mb-4 p-3 rounded-md border bg-accent/5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span>Preparing and uploading files…</span>
            </div>
          </div>
        )}

        <div className="mt-8 mb-6">
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-2">Retrieve Previous Results</h3>
              <p className="text-sm text-muted-foreground">Enter a Job ID or open one of your recent searches</p>
            </div>
            
            {storedSessions.length > 0 && (
              <div className="bg-muted/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Recent Jobs
                  </h4>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleClearAllSessions}
                    className="text-xs"
                  >
                    Clear All
                  </Button>
                </div>
                <div className="grid gap-2 max-h-40 overflow-y-auto">
                  {storedSessions.map((session) => (
                    <div key={session.id} className="flex items-center justify-between p-2 bg-background rounded border">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary">
                            {isGbkJob(session) ? 'GBK' : session.type}
                          </span>
                          <span className={`text-sm truncate ${isGbkJob(session) ? '' : 'font-mono'}`}>
                            {isGbkJob(session) ? (session.label || session.id) : session.id}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(session.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openJob(session)}
                          className="text-xs"
                        >
                          {session.type === 'property-gbk' ? 'Download' : 'Open'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveSession(session.id)}
                          className="text-xs text-destructive hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex items-center gap-3">
              <Input
                placeholder="Enter a Job ID to open its results"
                value={sessionIdInput}
                onChange={(e) => setSessionIdInput(e.target.value)}
                className="flex-1"
              />
              <Button onClick={fetchOldResults}>
                Get Results
              </Button>
            </div>
          </div>
        </div>
        {oldError && <div className="mb-4 text-center text-destructive">{oldError}</div>}
      </div>
    </MainLayout>
  );
}
